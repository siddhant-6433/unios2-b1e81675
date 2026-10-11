-- Keep existing reviewed candidates and transaction safety; bound each mutation RPC.

CREATE OR REPLACE FUNCTION public.apply_lead_cleanup(_run_id uuid,_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE run public.lead_cleanup_runs%ROWTYPE; item public.lead_cleanup_items%ROWTYPE; new_user uuid; n integer:=0;
BEGIN
 IF NOT public.can_cleanup_leads() THEN RAISE EXCEPTION 'Only a super admin can clean up leads' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.lead_cleanup_runs IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.lead_cleanup_policy IN EXCLUSIVE MODE;
 LOCK TABLE public.applications,public.students,public.lead_payments,public.payment_links IN SHARE MODE;
 LOCK TABLE public.lead_followups,public.lead_list_members,public.ai_call_queue,public.call_logs,public.ai_call_records,public.lead_assignment_history,public.lead_notes,public.lead_activities,public.whatsapp_scheduled_sends IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT run FROM public.lead_cleanup_runs WHERE id=_run_id FOR UPDATE;
 IF run.status NOT IN ('prepared','applying','applied') THEN RAISE EXCEPTION 'Cleanup cannot be applied in this state'; END IF;
 IF run.status='applied' THEN RETURN jsonb_build_object('remaining',0,'processed',0); END IF;
 PERFORM set_config('app.bulk_assign','on',true);
 PERFORM set_config('app.lead_cleanup','on',true);
 IF run.archive_list_id IS NULL THEN
 INSERT INTO public.lead_lists(name,description,source,purpose,list_type,created_by)
 VALUES('Old Leads — Marketing Archive — '||to_char(run.cutoff AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD'),
   'Archived prospects. Explicit marketing only; excluded from calling and daily pendency. Cleanup '||run.id,'manual','marketing','static',run.created_by)
 RETURNING id INTO run.archive_list_id;
 UPDATE public.lead_cleanup_runs SET archive_list_id=run.archive_list_id WHERE id=run.id;
 END IF;
 INSERT INTO public.lead_cleanup_policy(singleton,cutoff,run_id) VALUES(true,run.cutoff,run.id)
 ON CONFLICT(singleton) DO UPDATE SET cutoff=EXCLUDED.cutoff,run_id=EXCLUDED.run_id;
 UPDATE public.lead_cleanup_runs SET status='applying',policy_snapshot=(SELECT to_jsonb(p) FROM public.lead_cleanup_policy p) WHERE id=run.id;
 FOR item IN SELECT * FROM public.lead_cleanup_items WHERE run_id=run.id AND status='pending' ORDER BY lead_id LIMIT greatest(1,least(_limit,25)) FOR UPDATE LOOP
 PERFORM 1 FROM public.leads WHERE id=item.lead_id FOR UPDATE;
 -- Lock task/member rows before checking the snapshot. Parent lead locks also
 -- serialize new FK-linked tasks with this transaction.
 PERFORM 1 FROM public.lead_followups WHERE lead_id=item.lead_id FOR UPDATE;
 PERFORM 1 FROM public.lead_list_members WHERE lead_id=item.lead_id FOR UPDATE;
 PERFORM 1 FROM public.ai_call_queue WHERE lead_id=item.lead_id FOR UPDATE;
 IF public.lead_cleanup_protection(item.lead_id) IS NOT NULL
    OR public.lead_cleanup_snapshot(item.lead_id) IS DISTINCT FROM item.before_state THEN
 UPDATE public.lead_cleanup_items SET status='skipped',detail='Protected or changed since preview' WHERE run_id=run.id AND lead_id=item.lead_id;
 CONTINUE;
 END IF;
 IF item.action='retain' THEN
 SELECT p.user_id INTO new_user FROM public.profiles p WHERE p.id=item.destination AND p.archived_at IS NULL AND p.deleted_at IS NULL AND NOT p.login_disabled AND EXISTS(SELECT 1 FROM public.v_assignable_counsellors ac WHERE ac.profile_id=p.id);
 IF new_user IS NULL THEN RAISE EXCEPTION 'Destination counsellor is no longer active'; END IF;
 UPDATE public.leads SET counsellor_id=item.destination,assigned_at=now() WHERE id=item.lead_id;
 UPDATE public.lead_followups SET user_id=new_user WHERE lead_id=item.lead_id AND status='pending';
 UPDATE public.lead_list_members SET assigned_to=item.destination,assigned_at=now() WHERE lead_id=item.lead_id AND work_status='pending';
 INSERT INTO public.lead_assignment_history(lead_id,assigned_to,previous_counsellor_id,assigned_by_profile_id,assigned_by_user_id,assignment_source,bucket_name,lead_stage_at_assignment)
 SELECT l.id,item.destination,(item.before_state->'lead'->>'counsellor_id')::uuid,run.created_by,auth.uid(),'assigned','Backlog cleanup: '||item.reason,l.stage FROM public.leads l WHERE l.id=item.lead_id;
 ELSIF item.action='bucket' THEN
 UPDATE public.leads SET counsellor_id=NULL,assigned_at=NULL WHERE id=item.lead_id;
 UPDATE public.lead_followups SET user_id=NULL WHERE lead_id=item.lead_id AND status='pending';
 UPDATE public.lead_list_members SET assigned_to=NULL,assigned_at=NULL WHERE lead_id=item.lead_id AND work_status='pending';
 ELSE
 UPDATE public.leads SET archived_at=now(),archive_reason='Backlog cleanup: '||item.reason,cleanup_run_id=run.id WHERE id=item.lead_id;
 UPDATE public.lead_followups SET status='cancelled',completed_at=now(),notes=coalesce(notes,'')||E'\nCancelled: archived by cleanup '||run.id WHERE lead_id=item.lead_id AND status='pending';
 UPDATE public.lead_list_members SET work_status='not_dialable' WHERE lead_id=item.lead_id AND work_status='pending';
 UPDATE public.whatsapp_scheduled_sends SET status='skipped',error='Archived by cleanup '||run.id WHERE lead_id=item.lead_id AND status='pending';
 UPDATE public.ai_call_queue SET status='skipped',error_message='Archived by cleanup '||run.id WHERE lead_id=item.lead_id AND status IN ('pending','processing');
 INSERT INTO public.lead_list_members(list_id,lead_id,work_status) VALUES(run.archive_list_id,item.lead_id,'not_dialable');
 END IF;
 INSERT INTO public.lead_activities(lead_id,user_id,type,description) VALUES(item.lead_id,run.created_by,'note','Cleanup '||run.id||': '||item.action||' ('||item.reason||')');
 UPDATE public.lead_cleanup_items SET status='applied',after_state=public.lead_cleanup_snapshot(item.lead_id,run.archive_list_id) WHERE run_id=run.id AND lead_id=item.lead_id;
 n:=n+1;
 END LOOP;
 UPDATE public.lead_lists SET member_count=(SELECT count(*) FROM public.lead_list_members WHERE list_id=run.archive_list_id) WHERE id=run.archive_list_id;
 IF NOT EXISTS(SELECT 1 FROM public.lead_cleanup_items WHERE run_id=run.id AND status='pending') THEN
 UPDATE public.lead_cleanup_runs SET status='applied' WHERE id=run.id;
 END IF;
 RETURN jsonb_build_object('processed',n,'remaining',(SELECT count(*) FROM public.lead_cleanup_items WHERE run_id=run.id AND status='pending'));
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_lead_cleanup(_run_id uuid,_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE run public.lead_cleanup_runs%ROWTYPE; item public.lead_cleanup_items%ROWTYPE; old public.leads%ROWTYPE; row jsonb; f public.lead_followups%ROWTYPE; m public.lead_list_members%ROWTYPE; q public.ai_call_queue%ROWTYPE; w public.whatsapp_scheduled_sends%ROWTYPE; n integer:=0;
BEGIN
 IF NOT public.can_cleanup_leads() THEN RAISE EXCEPTION 'Only a super admin can roll back cleanup' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.lead_cleanup_runs IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.lead_cleanup_policy IN EXCLUSIVE MODE;
 LOCK TABLE public.applications,public.students,public.lead_payments,public.payment_links IN SHARE MODE;
 LOCK TABLE public.lead_followups,public.lead_list_members,public.ai_call_queue,public.call_logs,public.ai_call_records,public.lead_assignment_history,public.lead_notes,public.lead_activities,public.whatsapp_scheduled_sends IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT run FROM public.lead_cleanup_runs WHERE id=_run_id FOR UPDATE;
 IF run.status='rolled_back' THEN RETURN jsonb_build_object('remaining',0,'processed',0); END IF;
 PERFORM set_config('app.bulk_assign','on',true);
 PERFORM set_config('app.lead_cleanup','on',true);
 UPDATE public.lead_cleanup_runs SET status='rolling_back' WHERE id=run.id;
 UPDATE public.lead_cleanup_items SET status='skipped',detail='Cancelled by rollback before apply' WHERE run_id=run.id AND status='pending';
 FOR item IN SELECT * FROM public.lead_cleanup_items WHERE run_id=run.id AND status='applied' ORDER BY lead_id LIMIT greatest(1,least(_limit,25)) FOR UPDATE LOOP
 PERFORM 1 FROM public.leads WHERE id=item.lead_id FOR UPDATE;
 PERFORM 1 FROM public.lead_followups WHERE lead_id=item.lead_id FOR UPDATE;
 PERFORM 1 FROM public.lead_list_members WHERE lead_id=item.lead_id FOR UPDATE;
 PERFORM 1 FROM public.ai_call_queue WHERE lead_id=item.lead_id FOR UPDATE;
 IF public.lead_cleanup_protection(item.lead_id) IS NOT NULL OR public.lead_cleanup_snapshot(item.lead_id,run.archive_list_id) IS DISTINCT FROM item.after_state
    OR (item.action='archive' AND NOT EXISTS(SELECT 1 FROM public.lead_list_members WHERE list_id=run.archive_list_id AND lead_id=item.lead_id AND work_status='not_dialable' AND assigned_to IS NULL)) THEN
 UPDATE public.lead_cleanup_items SET status='conflict',detail='Later activity or admission protection; not overwritten' WHERE run_id=run.id AND lead_id=item.lead_id;
 CONTINUE;
 END IF;
 old:=jsonb_populate_record(NULL::public.leads,item.before_state->'lead');
 UPDATE public.leads SET counsellor_id=old.counsellor_id,assigned_at=old.assigned_at,archived_at=old.archived_at,archive_reason=old.archive_reason,cleanup_run_id=old.cleanup_run_id WHERE id=item.lead_id;
 -- Restore SLA timestamps after the ownership trigger has run. With the owner
 -- unchanged in this second update, it cannot replace the saved timestamps.
 UPDATE public.leads SET assigned_at=old.assigned_at,first_contact_at=old.first_contact_at WHERE id=item.lead_id;
 FOR row IN SELECT * FROM jsonb_array_elements(item.before_state->'followups') LOOP
 f:=jsonb_populate_record(NULL::public.lead_followups,row);
 UPDATE public.lead_followups SET user_id=f.user_id,status=f.status,completed_at=f.completed_at,notes=f.notes WHERE id=f.id;
 END LOOP;
 FOR row IN SELECT * FROM jsonb_array_elements(item.before_state->'members') LOOP
 m:=jsonb_populate_record(NULL::public.lead_list_members,row);
 UPDATE public.lead_list_members SET assigned_to=m.assigned_to,assigned_at=m.assigned_at,work_status=m.work_status WHERE list_id=m.list_id AND lead_id=item.lead_id;
 END LOOP;
 FOR row IN SELECT * FROM jsonb_array_elements(item.before_state->'scheduled_sends') LOOP
 w:=jsonb_populate_record(NULL::public.whatsapp_scheduled_sends,row);
 UPDATE public.whatsapp_scheduled_sends SET status=w.status,error=w.error,sent_at=w.sent_at WHERE id=w.id;
 END LOOP;
 FOR row IN SELECT * FROM jsonb_array_elements(item.before_state->'ai_queue') LOOP
 q:=jsonb_populate_record(NULL::public.ai_call_queue,row);
 UPDATE public.ai_call_queue SET status=q.status,error_message=q.error_message WHERE id=q.id;
 END LOOP;
 DELETE FROM public.lead_list_members WHERE list_id=run.archive_list_id AND lead_id=item.lead_id;
 IF item.action='retain' AND old.counsellor_id IS NOT NULL THEN
 INSERT INTO public.lead_assignment_history(lead_id,assigned_to,previous_counsellor_id,assigned_by_profile_id,assigned_by_user_id,assignment_source,bucket_name,lead_stage_at_assignment)
 VALUES(item.lead_id,old.counsellor_id,item.destination,run.created_by,auth.uid(),'assigned','Backlog cleanup rollback',old.stage);
 END IF;
 INSERT INTO public.lead_activities(lead_id,user_id,type,description) VALUES(item.lead_id,run.created_by,'note','Cleanup '||run.id||' rolled back');
 UPDATE public.lead_cleanup_items SET status='rolled_back' WHERE run_id=run.id AND lead_id=item.lead_id;
 n:=n+1;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.lead_cleanup_items WHERE run_id=run.id AND status='applied') THEN
   IF (SELECT to_jsonb(p) FROM public.lead_cleanup_policy p) IS NOT DISTINCT FROM run.policy_snapshot THEN
     DELETE FROM public.lead_cleanup_policy;
     IF run.previous_policy IS NOT NULL THEN INSERT INTO public.lead_cleanup_policy SELECT * FROM jsonb_populate_record(NULL::public.lead_cleanup_policy,run.previous_policy); END IF;
   END IF;
   UPDATE public.lead_cleanup_runs SET status='rolled_back' WHERE id=run.id;
 END IF;
 UPDATE public.lead_lists SET member_count=(SELECT count(*) FROM public.lead_list_members WHERE list_id=run.archive_list_id) WHERE id=run.archive_list_id;
 RETURN jsonb_build_object('processed',n,'remaining',(SELECT count(*) FROM public.lead_cleanup_items WHERE run_id=run.id AND status='applied'));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_automation_on_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF current_setting('app.lead_cleanup', true) = 'on' THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/automation-engine',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('trigger_type', 'activity_created', 'lead_id', NEW.lead_id, 'activity_type', NEW.type)
  );
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Cleanup reconciles its archive-list total once at the end of each atomic batch.
  IF current_setting('app.lead_cleanup', true) = 'on' THEN RETURN NULL; END IF;
  UPDATE public.lead_lists l
     SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = l.id),
         updated_at   = now()
   WHERE l.id IN (SELECT DISTINCT list_id FROM new_rows);
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Cleanup reconciles its archive-list total once at the end of each atomic batch.
  IF current_setting('app.lead_cleanup', true) = 'on' THEN RETURN NULL; END IF;
  UPDATE public.lead_lists l
     SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = l.id),
         updated_at   = now()
   WHERE l.id IN (SELECT DISTINCT list_id FROM old_rows);
  RETURN NULL;
END; $$;

ALTER FUNCTION public.apply_lead_cleanup(uuid,integer) SET statement_timeout='55s';

ALTER FUNCTION public.rollback_lead_cleanup(uuid,integer) SET statement_timeout='55s';

NOTIFY pgrst,'reload schema';
