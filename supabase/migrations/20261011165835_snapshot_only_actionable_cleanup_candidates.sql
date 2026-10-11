-- Keep admission locks, reviewed digest and exact snapshots for every mutable lead.
CREATE OR REPLACE FUNCTION public.prepare_lead_cleanup(_cutoff timestamptz,_expected_digest text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb; run uuid; creator uuid;
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
 -- Save full rollback snapshots only for records that can be mutated.
 -- Protected/review records are terminal and retain their archive/ownership metadata and complete preview fingerprint for audit.
 INSERT INTO public.lead_cleanup_items(run_id,lead_id,action,reason,destination,before_state,status)
 SELECT run,(item->>'lead_id')::uuid,item->>'action',item->>'reason',(item->>'destination')::uuid,coalesce(s.snapshot,jsonb_build_object('lead',jsonb_build_object('id',l.id,'stage',l.stage,'counsellor_id',l.counsellor_id,'assigned_at',l.assigned_at,'archived_at',l.archived_at,'archive_reason',l.archive_reason,'cleanup_run_id',l.cleanup_run_id),'preview_fingerprint',item->>'fingerprint')),
   CASE WHEN item->>'action' IN ('protected','review') THEN item->>'action' ELSE 'pending' END
 FROM jsonb_array_elements(plan->'items') item
 LEFT JOIN public.lead_cleanup_snapshots(ARRAY(SELECT (x->>'lead_id')::uuid FROM jsonb_array_elements(plan->'items') x WHERE x->>'action' IN ('archive','retain','bucket'))) s
 ON s.lead_id=(item->>'lead_id')::uuid
 JOIN public.leads l ON l.id=(item->>'lead_id')::uuid;
 RETURN run;
END;
$$;
ALTER FUNCTION public.prepare_lead_cleanup(timestamptz,text) SET statement_timeout='55s';
NOTIFY pgrst,'reload schema';
