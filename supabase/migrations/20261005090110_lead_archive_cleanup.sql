-- Reversible backlog cleanup. No cleanup runs or lead mutations occur on deploy.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS cleanup_run_id uuid;
CREATE INDEX IF NOT EXISTS leads_active_created_idx ON public.leads(created_at,id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.lead_cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cutoff timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  preview_digest text NOT NULL, archive_list_id uuid REFERENCES public.lead_lists(id),
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','applying','applied','rolling_back','rolled_back')),
  previous_policy jsonb, policy_snapshot jsonb
);
CREATE TABLE IF NOT EXISTS public.lead_cleanup_items (
  run_id uuid NOT NULL REFERENCES public.lead_cleanup_runs(id), lead_id uuid NOT NULL REFERENCES public.leads(id),
  action text NOT NULL, reason text NOT NULL, destination uuid REFERENCES public.profiles(id),
  before_state jsonb NOT NULL, after_state jsonb,
  status text NOT NULL CHECK(status IN ('pending','protected','review','applied','skipped','rolled_back','conflict')),
  detail text, PRIMARY KEY(run_id,lead_id)
);
CREATE TABLE IF NOT EXISTS public.lead_cleanup_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), cutoff timestamptz NOT NULL,
  run_id uuid NOT NULL REFERENCES public.lead_cleanup_runs(id)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.leads'::regclass AND conname='leads_cleanup_run_fk') THEN
 ALTER TABLE public.leads ADD CONSTRAINT leads_cleanup_run_fk FOREIGN KEY(cleanup_run_id) REFERENCES public.lead_cleanup_runs(id);
 END IF;
END $$;
ALTER TABLE public.lead_cleanup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_cleanup_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_cleanup_policy ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_cleanup_leads() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'super_admin'::public.app_role);
$$;
DROP POLICY IF EXISTS cleanup_runs_read ON public.lead_cleanup_runs;
CREATE POLICY cleanup_runs_read ON public.lead_cleanup_runs FOR SELECT TO authenticated USING(public.can_cleanup_leads());
DROP POLICY IF EXISTS cleanup_items_read ON public.lead_cleanup_items;
CREATE POLICY cleanup_items_read ON public.lead_cleanup_items FOR SELECT TO authenticated USING(public.can_cleanup_leads());
GRANT SELECT ON public.lead_cleanup_runs, public.lead_cleanup_items TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_phone(_phone text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN length(digits)=12 AND left(digits,2)='91' THEN right(digits,10)
             WHEN length(digits)=11 AND left(digits,1)='0' THEN right(digits,10)
             WHEN length(digits)>=10 THEN digits ELSE NULL END
 FROM (SELECT regexp_replace(coalesce(_phone,''),'[^0-9]','','g') AS digits) n;
$$;

CREATE OR REPLACE FUNCTION public.lead_cleanup_protection(_lead_id uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE l public.leads%ROWTYPE; p text;
BEGIN
 SELECT * INTO l FROM public.leads WHERE id=_lead_id;
 IF NOT FOUND THEN RETURN 'missing'; END IF;
 IF l.application_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.applications a WHERE a.lead_id=l.id) THEN RETURN 'application'; END IF;
 IF EXISTS(SELECT 1 FROM public.students s WHERE s.lead_id=l.id) THEN RETURN 'student'; END IF;
 IF l.admission_no IS NOT NULL OR l.pre_admission_no IS NOT NULL OR l.legacy_admission_no IS NOT NULL
    OR l.legacy_pre_admission_no IS NOT NULL OR l.admitted_at IS NOT NULL OR l.applied_at IS NOT NULL
    OR l.stage::text IN ('application_in_progress','application_submitted','application_fee_paid','application_approved',
      'interview','offer_sent','token_paid','pre_admitted','admitted','waitlisted')
    OR (l.application_progress IS NOT NULL AND l.application_progress NOT IN ('{}'::jsonb,'null'::jsonb))
    OR coalesce(l.person_role,'lead')<>'lead' THEN RETURN 'admission'; END IF;
 IF EXISTS(SELECT 1 FROM public.lead_payments p WHERE p.lead_id=l.id)
    OR EXISTS(SELECT 1 FROM public.payment_links p WHERE p.lead_id=l.id)
    OR coalesce(l.token_amount,0)>0 THEN RETURN 'payment'; END IF;
 p:=public.cleanup_phone(l.phone);
 IF p IS NOT NULL AND (EXISTS(SELECT 1 FROM public.applications a WHERE public.cleanup_phone(a.phone)=p)
    OR EXISTS(SELECT 1 FROM public.students s WHERE p IN (public.cleanup_phone(s.phone),public.cleanup_phone(s.father_phone),
      public.cleanup_phone(s.mother_phone),public.cleanup_phone(s.guardian_phone)))) THEN RETURN 'possible_applicant_student_phone'; END IF;
 RETURN NULL;
END;
$$;

-- Snapshot all related task rows, not just pending ones: a new task or staff edit
-- after preview also invalidates the preview/rollback.
CREATE OR REPLACE FUNCTION public.lead_cleanup_snapshot(_lead_id uuid, _exclude_list uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
 'lead',(SELECT to_jsonb(l) FROM public.leads l WHERE l.id=_lead_id),
 'notes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM public.lead_notes n WHERE n.lead_id=_lead_id),'[]'::jsonb),
 'activities',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.lead_activities a WHERE a.lead_id=_lead_id),'[]'::jsonb),
 'scheduled_sends',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.whatsapp_scheduled_sends w WHERE w.lead_id=_lead_id),'[]'::jsonb),
 'followups',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.lead_followups f WHERE f.lead_id=_lead_id),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.list_id) FROM public.lead_list_members m WHERE m.lead_id=_lead_id AND m.list_id IS DISTINCT FROM _exclude_list),'[]'::jsonb),
 'ai_queue',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.ai_call_queue q WHERE q.lead_id=_lead_id),'[]'::jsonb),
 'assignment_history',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.lead_assignment_history h WHERE h.lead_id=_lead_id),'[]'::jsonb),
 'ai_calls',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.ai_call_records a WHERE a.lead_id=_lead_id),'[]'::jsonb),
 'calls',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.call_logs c WHERE c.lead_id=_lead_id),'[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.lead_cleanup_classify(_cutoff timestamptz)
RETURNS TABLE(lead_id uuid, name text, action text, reason text, destination uuid, fingerprint text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE staff jsonb:='{}'; key text; ids uuid[]; nursing uuid[];
BEGIN
 FOREACH key IN ARRAY ARRAY['ashish','payal','reema','harsh verma'] LOOP
   SELECT array_agg(p.id ORDER BY p.id) INTO ids FROM public.profiles p
   WHERE lower(btrim(p.display_name)) ~ ('^'||key||'($| )') AND p.archived_at IS NULL AND p.deleted_at IS NULL
     AND NOT p.login_disabled AND p.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.v_assignable_counsellors ac WHERE ac.profile_id=p.id);
   IF coalesce(cardinality(ids),0)<>1 THEN RAISE EXCEPTION 'Resolve one active staff profile for %, found %',key,coalesce(cardinality(ids),0); END IF;
   staff:=staff||jsonb_build_object(key,ids[1]);
 END LOOP;
 IF (SELECT count(DISTINCT value) FROM jsonb_each_text(staff))<>4 THEN RAISE EXCEPTION 'Staff destinations must be distinct'; END IF;
 SELECT array_agg(c.id ORDER BY c.id) INTO nursing FROM public.courses c
 WHERE upper(c.code) IN ('BSCN-GN','GNM-GN') OR regexp_replace(lower(c.name),'[^a-z0-9]','','g') IN
   ('bscnursing','bachelorofscienceinnursing','bachelorofscienceinnursingbscnursing','gnm','generalnursingandmidwifery','generalnursingmidwiferygnm','generalnursingandmidwiferygnm','diplomaingeneralnursingandmidwifery');
 IF NOT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=ANY(nursing) AND lower(c.name) ~ 'nursing' AND lower(c.name) !~ 'midwifery')
    OR NOT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=ANY(nursing) AND (lower(c.name) ~ 'midwifery' OR lower(btrim(c.name))='gnm'))
 THEN RAISE EXCEPTION 'Resolve canonical BSc Nursing and GNM course IDs before cleanup'; END IF;
 RETURN QUERY
 WITH base AS (
 SELECT l.*, public.lead_cleanup_protection(l.id) AS protection,
   coalesce(i.type,CASE WHEN l.lead_institution_type='school' THEN 'school' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.institutions ci WHERE ci.campus_id=l.campus_id AND ci.type='school') THEN 'school' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.jd_category_mappings jm WHERE lower(jm.category)=lower(l.jd_category) AND jm.is_school) THEN 'school' END,'college') AS institution_type, d.institution_id,
   (SELECT calls.disposition FROM (SELECT cl.disposition,cl.called_at AS at,cl.id FROM public.call_logs cl WHERE cl.lead_id=l.id AND cl.disposition IS NOT NULL
 UNION ALL SELECT a.disposition,coalesce(a.completed_at,a.created_at),a.id FROM public.ai_call_records a WHERE a.lead_id=l.id AND a.disposition IS NOT NULL) calls ORDER BY calls.at DESC,calls.id DESC LIMIT 1) AS latest_disposition,
   EXISTS(SELECT 1 FROM public.lead_followups f WHERE f.lead_id=l.id AND f.status='pending' AND f.type IS DISTINCT FROM 'cold_followup') AS human_followup
 FROM public.leads l LEFT JOIN public.courses c ON c.id=l.course_id
 LEFT JOIN public.departments d ON d.id=c.department_id LEFT JOIN public.institutions i ON i.id=d.institution_id
 WHERE (l.created_at<_cutoff OR l.counsellor_id IS NOT NULL) AND l.archived_at IS NULL
 ), classified AS (
 SELECT b.*, CASE
 WHEN protection IS NOT NULL THEN CASE WHEN protection='possible_applicant_student_phone' THEN 'review' ELSE 'protected' END
 WHEN is_mirror OR mirror_lead_id IS NOT NULL OR source_lead_id IS NOT NULL THEN 'review'
 WHEN shared_with_nimt IS FALSE THEN 'review'
 WHEN EXISTS(SELECT 1 FROM public.ai_call_records a WHERE a.lead_id=b.id AND a.status IN ('initiated','in_progress'))
   OR EXISTS(SELECT 1 FROM public.ai_call_queue q WHERE q.lead_id=b.id AND q.status='processing') THEN 'review'
 WHEN created_at>=_cutoff THEN CASE WHEN EXISTS(SELECT 1 FROM public.lead_assignment_history h WHERE h.lead_id=b.id AND h.assignment_source IN ('assigned','self_picked','list_round_robin','list_followup'))
   OR NOT EXISTS(SELECT 1 FROM public.lead_assignment_history h WHERE h.lead_id=b.id AND h.assignment_source='ai_priority') THEN 'review' ELSE 'bucket' END
 WHEN stage::text IN ('not_interested','dnc','rejected','ineligible') THEN 'archive'
 WHEN course_id=ANY(nursing) AND institution_id IS NOT NULL AND institution_type<>'school' THEN 'ashish'
 WHEN institution_id='d8c95a30-ecc6-4b41-8bed-987c960dc44a'::uuid OR lower(coalesce(portal_brand,''))='mirai'
   OR (lead_institution_type='school' AND campus_id='c0000002-0000-0000-0000-000000000001'::uuid AND institution_id IS NULL) THEN 'mirai'
 WHEN course_id IS NOT NULL AND institution_id IS NULL THEN 'review'
 WHEN (institution_type='school' OR lead_institution_type='school') AND
   (stage::text IN ('priority_interested','visit_scheduled') OR latest_disposition='interested' OR human_followup) THEN 'payal'
 WHEN course_id IS NOT NULL AND institution_id IS NULL THEN 'review'
 WHEN course_id IS NULL AND institution_type<>'school' THEN 'review'
 ELSE 'archive' END AS target
 FROM base b
 ), ranked AS (
 SELECT c.*, sum(CASE WHEN target='mirai' THEN 1 ELSE 0 END) OVER(ORDER BY created_at,id) AS mirai_rank FROM classified c
 )
 SELECT r.id,r.name,
 CASE WHEN target IN ('ashish','payal','mirai') THEN 'retain' ELSE target END,
 coalesce(protection,CASE WHEN is_mirror OR mirror_lead_id IS NOT NULL OR source_lead_id IS NOT NULL THEN 'mirror_relationship'
   WHEN shared_with_nimt IS FALSE THEN 'private_partner_lead'
   WHEN EXISTS(SELECT 1 FROM public.ai_call_records a WHERE a.lead_id=r.id AND a.status IN ('initiated','in_progress'))
     OR EXISTS(SELECT 1 FROM public.ai_call_queue q WHERE q.lead_id=r.id AND q.status='processing') THEN 'active_call' WHEN created_at>=_cutoff AND target='review' THEN 'new_assignment_needs_review' WHEN target='bucket' THEN 'arrived_after_cutoff'
   WHEN target='review' THEN 'ambiguous_classification'
   WHEN target='archive' THEN 'old_backlog' ELSE target END),
 CASE WHEN target='mirai' THEN (staff->>CASE WHEN mirai_rank%2=1 THEN 'reema' ELSE 'harsh verma' END)::uuid
      WHEN target IN ('ashish','payal') THEN (staff->>target)::uuid ELSE NULL END,
 md5(public.lead_cleanup_snapshot(r.id)::text)
 FROM ranked r ORDER BY r.created_at,r.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_lead_cleanup(_cutoff timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.can_cleanup_leads() THEN RAISE EXCEPTION 'Only a super admin can clean up leads' USING ERRCODE='42501'; END IF;
 IF _cutoff IS NULL OR _cutoff>now() THEN RAISE EXCEPTION 'Cutoff must be fixed at or before now'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.lead_id),'[]'::jsonb) INTO rows FROM public.lead_cleanup_classify(_cutoff) c;
 RETURN jsonb_build_object('cutoff',_cutoff,'digest',md5(rows::text),'items',rows,
   'staff',(SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)) FROM public.profiles p
     WHERE p.id IN (SELECT (x->>'destination')::uuid FROM jsonb_array_elements(rows) x)));
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_lead_cleanup(_cutoff timestamptz,_expected_digest text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb; run uuid; item jsonb; creator uuid;
BEGIN
 IF NOT public.can_cleanup_leads() THEN RAISE EXCEPTION 'Only a super admin can clean up leads' USING ERRCODE='42501'; END IF;
 -- Serialize cleanup against admissions creation, then lock candidate leads.
 LOCK TABLE public.lead_cleanup_runs IN EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.lead_cleanup_runs WHERE status IN ('prepared','applying','rolling_back')) THEN RAISE EXCEPTION 'Finish or roll back the existing cleanup first'; END IF;
 LOCK TABLE public.applications,public.students,public.lead_payments,public.payment_links IN SHARE MODE;
 LOCK TABLE public.lead_followups,public.lead_list_members,public.ai_call_queue,public.call_logs,public.ai_call_records,public.lead_assignment_history,public.lead_notes,public.lead_activities,public.whatsapp_scheduled_sends IN SHARE ROW EXCLUSIVE MODE;
 PERFORM 1 FROM public.leads WHERE (created_at<_cutoff OR counsellor_id IS NOT NULL) AND archived_at IS NULL ORDER BY id FOR UPDATE;
 plan:=public.preview_lead_cleanup(_cutoff);
 IF plan->>'digest' IS DISTINCT FROM _expected_digest THEN RAISE EXCEPTION 'Preview changed. Review a fresh preview before applying'; END IF;
 SELECT id INTO STRICT creator FROM public.profiles WHERE user_id=auth.uid();
 INSERT INTO public.lead_cleanup_runs(cutoff,created_by,preview_digest,previous_policy)
 VALUES(_cutoff,creator,_expected_digest,(SELECT to_jsonb(p) FROM public.lead_cleanup_policy p)) RETURNING id INTO run;
 FOR item IN SELECT * FROM jsonb_array_elements(plan->'items') LOOP
 INSERT INTO public.lead_cleanup_items(run_id,lead_id,action,reason,destination,before_state,status)
 VALUES(run,(item->>'lead_id')::uuid,item->>'action',item->>'reason',(item->>'destination')::uuid,
   public.lead_cleanup_snapshot((item->>'lead_id')::uuid),
   CASE WHEN item->>'action' IN ('protected','review') THEN item->>'action' ELSE 'pending' END);
 END LOOP;
 RETURN run;
END;
$$;

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
 FOR item IN SELECT * FROM public.lead_cleanup_items WHERE run_id=run.id AND status='pending' ORDER BY lead_id LIMIT greatest(1,least(_limit,500)) FOR UPDATE LOOP
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
 UPDATE public.lead_cleanup_runs SET status='rolling_back' WHERE id=run.id;
 UPDATE public.lead_cleanup_items SET status='skipped',detail='Cancelled by rollback before apply' WHERE run_id=run.id AND status='pending';
 FOR item IN SELECT * FROM public.lead_cleanup_items WHERE run_id=run.id AND status='applied' ORDER BY lead_id LIMIT greatest(1,least(_limit,500)) FOR UPDATE LOOP
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

-- Readable to marketing/detail pages; excluded only from active work surfaces.
-- lint-allow: archive filtering preserves caller lead RLS; definer queues retain their existing access checks.
CREATE OR REPLACE VIEW public.active_outreach_leads WITH(security_invoker=true) AS SELECT * FROM public.leads WHERE archived_at IS NULL WITH LOCAL CHECK OPTION;
-- lint-allow: internal assignment routines execute as owner; this view never bypasses caller lead RLS.
CREATE OR REPLACE VIEW public.auto_assignable_leads WITH(security_invoker=true) AS
 SELECT * FROM public.leads l WHERE l.archived_at IS NULL AND NOT EXISTS(
 SELECT 1 FROM public.lead_cleanup_policy p WHERE l.created_at>=p.cutoff AND l.counsellor_id IS NULL)
 WITH LOCAL CHECK OPTION;
GRANT SELECT,UPDATE ON public.active_outreach_leads TO authenticated,service_role;
REVOKE ALL ON public.auto_assignable_leads FROM authenticated;
GRANT SELECT,UPDATE ON public.auto_assignable_leads TO service_role;

-- Preserve deployed overloads and business rules. Change the source relation,
-- not stage semantics, across the existing work queues and automation routines.
DO $$
DECLARE r record; definition text; target text;
BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.prokind='f' AND p.proname=ANY(ARRAY[
 'get_unassigned_leads_bucket','cloud_dialer_queue','cloud_dialer_campaign_queue','cloud_dialer_list_queue',
 'pending_followups_payload','followup_badge_bucket_counts','admissions_followup_bucket_counts','admissions_overview',
 'get_counsellor_performance_stats','counsellor_dial_guard','fn_reclaim_overdue_leads','fn_count_leads_reclaim_soon',
 'fn_cold_lead_cycle','call_list_followup_candidates','cahet_sprint_queue','updeled_sprint_queue',
 'fn_round_robin_assign_counsellor','fn_intake_round_robin_assign','fn_intake_reassign','fn_assign_priority_interested_lead',
 'fn_auto_elevate_priority_interested','ensure_followup_for_manual_no_answer',
 'preview_call_list_assignment','assign_lead_list_round_robin','claim_leads',
 'fresh_leads_payload','action_badge_counts','my_tat_defaults','dashboard_overview','get_active_overview','get_lead_stage_counts']) LOOP
 definition:=pg_get_functiondef(r.oid);
 target:=CASE WHEN r.proname IN ('fn_round_robin_assign_counsellor','fn_intake_round_robin_assign','fn_intake_reassign','fn_assign_priority_interested_lead')
 THEN 'public.auto_assignable_leads' ELSE 'public.active_outreach_leads' END;
 IF r.proname IN ('fn_round_robin_assign_counsellor','fn_intake_round_robin_assign','fn_intake_reassign','fn_assign_priority_interested_lead') AND position('IF NOT EXISTS(SELECT 1 FROM public.auto_assignable_leads WHERE id=_lead_id)' in definition)=0 THEN
 definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n IF NOT EXISTS(SELECT 1 FROM public.auto_assignable_leads WHERE id=_lead_id) THEN RETURN NULL; END IF;','i');
 END IF;
 definition:=regexp_replace(definition,'\m(FROM|JOIN|UPDATE)\s+(public\.)?leads\M','\1 '||target,'gi');
 EXECUTE definition;
 END LOOP;
END;
$$;

DO $$
DECLARE r record; definition text;
BEGIN
 FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='v' AND c.relname IN ('overdue_followups','counsellor_tat_defaults','cold_cycle_state','counsellor_funnel_stats','counsellor_performance_stats','sla_breached_leads','sla_warning_leads') LOOP
 definition:=regexp_replace(pg_get_viewdef(r.oid,true),'\m(FROM|JOIN)\s+(public\.)?leads\M','\1 public.active_outreach_leads','gi');
 EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s',r.relname,definition);
 END LOOP;
END;
$$;

-- Guard task insertion even when an edge worker holds a previously fetched lead.
-- Reserve outbound calls under the same lead lock used by cleanup. The active
-- tracking row must commit before contacting the provider.
CREATE OR REPLACE FUNCTION public.guard_archived_call_start() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE archived timestamptz;
BEGIN
 IF NEW.lead_id IS NOT NULL AND NEW.status IN ('initiated','in_progress') THEN
   SELECT archived_at INTO archived FROM public.leads WHERE id=NEW.lead_id FOR UPDATE;
   IF archived IS NOT NULL THEN RAISE EXCEPTION 'Archived lead cannot start a call' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_archived_call_start ON public.ai_call_records;
CREATE TRIGGER guard_archived_call_start BEFORE INSERT OR UPDATE ON public.ai_call_records FOR EACH ROW EXECUTE FUNCTION public.guard_archived_call_start();

CREATE OR REPLACE FUNCTION public.guard_archived_lead_work() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.leads WHERE id=NEW.lead_id AND archived_at IS NOT NULL) THEN
   IF TG_TABLE_NAME='lead_followups' THEN
     IF NEW.status='pending' THEN RETURN NULL; END IF;
   ELSIF TG_TABLE_NAME='whatsapp_scheduled_sends' THEN
     IF NEW.status='pending' THEN RETURN NULL; END IF;
   ELSIF TG_TABLE_NAME='ai_call_queue' THEN
     IF NEW.status IN ('pending','processing') THEN RETURN NULL; END IF;
   ELSIF TG_TABLE_NAME='lead_list_members' THEN NEW.work_status:='not_dialable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_archived_followups ON public.lead_followups;
CREATE TRIGGER guard_archived_followups BEFORE INSERT OR UPDATE ON public.lead_followups FOR EACH ROW EXECUTE FUNCTION public.guard_archived_lead_work();
DROP TRIGGER IF EXISTS guard_archived_scheduled_send ON public.whatsapp_scheduled_sends;
CREATE TRIGGER guard_archived_scheduled_send BEFORE INSERT OR UPDATE ON public.whatsapp_scheduled_sends FOR EACH ROW EXECUTE FUNCTION public.guard_archived_lead_work();
DROP TRIGGER IF EXISTS guard_archived_ai_queue ON public.ai_call_queue;
CREATE TRIGGER guard_archived_ai_queue BEFORE INSERT OR UPDATE ON public.ai_call_queue FOR EACH ROW EXECUTE FUNCTION public.guard_archived_lead_work();
DROP TRIGGER IF EXISTS guard_archived_list_members ON public.lead_list_members;
CREATE TRIGGER guard_archived_list_members BEFORE INSERT OR UPDATE ON public.lead_list_members FOR EACH ROW EXECUTE FUNCTION public.guard_archived_lead_work();

CREATE OR REPLACE FUNCTION public.guard_cleanup_archive() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.archived_at IS NOT NULL OR NEW.archive_reason IS NOT NULL OR NEW.cleanup_run_id IS NOT NULL THEN
     RAISE EXCEPTION 'New leads cannot be inserted as archived';
   END IF;
   IF EXISTS(SELECT 1 FROM public.lead_cleanup_policy WHERE NEW.created_at>=cutoff)
      AND public.lead_cleanup_protection(NEW.id)='missing' AND coalesce(NEW.person_role,'lead')='lead'
      AND NEW.application_id IS NULL AND NEW.admission_no IS NULL AND NEW.pre_admission_no IS NULL
      AND (NEW.application_progress IS NULL OR NEW.application_progress IN ('{}'::jsonb,'null'::jsonb))
      AND NEW.legacy_admission_no IS NULL AND NEW.legacy_pre_admission_no IS NULL AND NEW.applied_at IS NULL AND NEW.admitted_at IS NULL AND coalesce(NEW.token_amount,0)=0
      AND NEW.stage::text IN ('new_lead','ai_called','counsellor_call','priority_interested','visit_scheduled','cold','deferred') THEN
      NEW.counsellor_id:=NULL; NEW.assigned_at:=NULL;
   END IF;
 ELSE
   IF (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archive_reason IS DISTINCT FROM OLD.archive_reason OR NEW.cleanup_run_id IS DISTINCT FROM OLD.cleanup_run_id) AND NOT public.can_cleanup_leads() THEN
     RAISE EXCEPTION 'Only a super admin can change lead archive metadata' USING ERRCODE='42501';
   END IF;
   IF NEW.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at
      AND public.lead_cleanup_protection(OLD.id) IS NOT NULL THEN RAISE EXCEPTION 'Admission-linked leads cannot be archived'; END IF;
   IF OLD.counsellor_id IS NULL AND NEW.counsellor_id IS NOT NULL AND auth.uid() IS NULL
      AND EXISTS(SELECT 1 FROM public.lead_cleanup_policy p WHERE OLD.created_at>=p.cutoff)
      AND public.lead_cleanup_protection(OLD.id) IS NULL THEN
     NEW.counsellor_id:=NULL; NEW.assigned_at:=NULL;
   END IF;
   IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL AND auth.uid() IS NULL AND NEW.stage IS DISTINCT FROM OLD.stage THEN
     RAISE EXCEPTION 'Archived lead cannot advance through automation';
   END IF;
   IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL AND NEW.counsellor_id IS DISTINCT FROM OLD.counsellor_id THEN
     RAISE EXCEPTION 'Restore an archived lead before reassigning it'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aaa_guard_cleanup_archive ON public.leads;
CREATE TRIGGER aaa_guard_cleanup_archive BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.guard_cleanup_archive();

-- Send-time guard only applies to archive audiences, preserving transactional
-- application campaigns. Fail closed when archived recipients gain admissions.
CREATE OR REPLACE FUNCTION public.archive_marketing_recipient_allowed(_lead_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.leads l WHERE l.id=_lead_id AND (l.archived_at IS NULL OR
   (public.lead_cleanup_protection(l.id) IS NULL AND l.stage::text<>'dnc' AND NOT EXISTS(
     SELECT 1 FROM public.marketing_contacts c WHERE c.opted_out AND (public.cleanup_phone(c.phone)=public.cleanup_phone(l.phone)
       OR (nullif(lower(btrim(l.email)),'') IS NOT NULL AND lower(btrim(c.email))=lower(btrim(l.email))))))));
$$;

-- Internal helpers are never callable by unauthenticated or ordinary staff.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname=ANY(ARRAY['can_cleanup_leads','cleanup_phone','lead_cleanup_protection','lead_cleanup_snapshot','lead_cleanup_classify',
 'preview_lead_cleanup','prepare_lead_cleanup','apply_lead_cleanup','rollback_lead_cleanup','guard_archived_lead_work','guard_archived_call_start','guard_cleanup_archive','archive_marketing_recipient_allowed']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.signature);
 IF r.proname IN ('can_cleanup_leads','preview_lead_cleanup','prepare_lead_cleanup','apply_lead_cleanup','rollback_lead_cleanup') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature); END IF;
 IF r.proname='archive_marketing_recipient_allowed' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature); END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.lead_cleanup_report(_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.can_cleanup_leads() THEN RAISE EXCEPTION 'Only a super admin can view cleanup reports' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('run',(SELECT to_jsonb(r) FROM public.lead_cleanup_runs r WHERE r.id=_run_id),
 'counts',(SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) FROM (SELECT status,count(*) n FROM public.lead_cleanup_items WHERE run_id=_run_id GROUP BY status) c),
 'mirai_balanced',(SELECT CASE count(*) WHEN 0 THEN true WHEN 1 THEN max(n)<=1 ELSE max(n)-min(n)<=1 END FROM (SELECT destination,count(*) n FROM public.lead_cleanup_items WHERE run_id=_run_id AND reason='mirai' AND status='applied' GROUP BY destination) totals),
 'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM (
 SELECT p.display_name AS name,count(*) AS count FROM public.lead_cleanup_items i JOIN public.profiles p ON p.id=i.destination
 WHERE i.run_id=_run_id AND i.status='applied' GROUP BY p.display_name) a),
 'exceptions',(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM (
 SELECT lead_id,status,reason,detail FROM public.lead_cleanup_items WHERE run_id=_run_id AND status IN ('review','skipped','conflict') ORDER BY lead_id) i));
END;
$$;
REVOKE ALL ON FUNCTION public.lead_cleanup_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lead_cleanup_report(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS cleanup_application_phone_idx ON public.applications(public.cleanup_phone(phone));
CREATE INDEX IF NOT EXISTS cleanup_student_phone_idx ON public.students(public.cleanup_phone(phone));
CREATE INDEX IF NOT EXISTS cleanup_student_father_phone_idx ON public.students(public.cleanup_phone(father_phone));
CREATE INDEX IF NOT EXISTS cleanup_student_mother_phone_idx ON public.students(public.cleanup_phone(mother_phone));
CREATE INDEX IF NOT EXISTS cleanup_student_guardian_phone_idx ON public.students(public.cleanup_phone(guardian_phone));
GRANT EXECUTE ON FUNCTION public.cleanup_phone(text) TO authenticated,service_role;
