-- Fix backlog preview timeouts without changing classification or audit values.
-- Collect each related history in one grouped pass instead of one query per lead.
CREATE OR REPLACE FUNCTION public.lead_cleanup_snapshots(_lead_ids uuid[],_exclude_list uuid DEFAULT NULL)
RETURNS TABLE(lead_id uuid,snapshot jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH candidates AS MATERIALIZED (SELECT l.id,to_jsonb(l) AS lead FROM public.leads l WHERE l.id=ANY(_lead_ids)),
notes AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.lead_notes t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
activities AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.lead_activities t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
scheduled_sends AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.whatsapp_scheduled_sends t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
followups AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.lead_followups t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
members AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.list_id) AS rows FROM public.lead_list_members t JOIN candidates c ON c.id=t.lead_id WHERE true AND t.list_id IS DISTINCT FROM _exclude_list GROUP BY t.lead_id),
ai_queue AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.ai_call_queue t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
assignment_history AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.lead_assignment_history t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
ai_calls AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.ai_call_records t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id),
calls AS (SELECT t.lead_id,jsonb_agg(to_jsonb(t) ORDER BY t.id) AS rows FROM public.call_logs t JOIN candidates c ON c.id=t.lead_id WHERE true GROUP BY t.lead_id)
SELECT c.id,jsonb_build_object(
'lead',c.lead,
'notes',coalesce(notes.rows,'[]'::jsonb),
'activities',coalesce(activities.rows,'[]'::jsonb),
'scheduled_sends',coalesce(scheduled_sends.rows,'[]'::jsonb),
'followups',coalesce(followups.rows,'[]'::jsonb),
'members',coalesce(members.rows,'[]'::jsonb),
'ai_queue',coalesce(ai_queue.rows,'[]'::jsonb),
'assignment_history',coalesce(assignment_history.rows,'[]'::jsonb),
'ai_calls',coalesce(ai_calls.rows,'[]'::jsonb),
'calls',coalesce(calls.rows,'[]'::jsonb)) FROM candidates c
LEFT JOIN notes ON notes.lead_id=c.id
LEFT JOIN activities ON activities.lead_id=c.id
LEFT JOIN scheduled_sends ON scheduled_sends.lead_id=c.id
LEFT JOIN followups ON followups.lead_id=c.id
LEFT JOIN members ON members.lead_id=c.id
LEFT JOIN ai_queue ON ai_queue.lead_id=c.id
LEFT JOIN assignment_history ON assignment_history.lead_id=c.id
LEFT JOIN ai_calls ON ai_calls.lead_id=c.id
LEFT JOIN calls ON calls.lead_id=c.id;
$$;
REVOKE ALL ON FUNCTION public.lead_cleanup_snapshots(uuid[],uuid) FROM PUBLIC,anon,authenticated;

-- Hash every complete row before aggregation: the preview needs change
-- detection, not a second in-memory copy of the entire backlog's audit history.
-- Full snapshots are still saved at preparation and checked before apply.
CREATE OR REPLACE FUNCTION public.lead_cleanup_fingerprints(_lead_ids uuid[])
RETURNS TABLE(lead_id uuid,fingerprint text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH candidates AS MATERIALIZED (SELECT l.id,to_jsonb(l) AS lead FROM public.leads l WHERE l.id=ANY(_lead_ids)),
notes AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.lead_notes t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
activities AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.lead_activities t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
scheduled_sends AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.whatsapp_scheduled_sends t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
followups AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.lead_followups t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
members AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.list_id)) AS hash FROM public.lead_list_members t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
ai_queue AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.ai_call_queue t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
assignment_history AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.lead_assignment_history t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
ai_calls AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.ai_call_records t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id),
calls AS (SELECT t.lead_id,md5(string_agg(md5(to_jsonb(t)::text),'' ORDER BY t.id)) AS hash FROM public.call_logs t JOIN candidates c ON c.id=t.lead_id GROUP BY t.lead_id)
SELECT c.id,md5(jsonb_build_object(
'lead',md5(c.lead::text),
'notes',coalesce(notes.hash,md5('')),
'activities',coalesce(activities.hash,md5('')),
'scheduled_sends',coalesce(scheduled_sends.hash,md5('')),
'followups',coalesce(followups.hash,md5('')),
'members',coalesce(members.hash,md5('')),
'ai_queue',coalesce(ai_queue.hash,md5('')),
'assignment_history',coalesce(assignment_history.hash,md5('')),
'ai_calls',coalesce(ai_calls.hash,md5('')),
'calls',coalesce(calls.hash,md5('')))::text) FROM candidates c
LEFT JOIN notes ON notes.lead_id=c.id
LEFT JOIN activities ON activities.lead_id=c.id
LEFT JOIN scheduled_sends ON scheduled_sends.lead_id=c.id
LEFT JOIN followups ON followups.lead_id=c.id
LEFT JOIN members ON members.lead_id=c.id
LEFT JOIN ai_queue ON ai_queue.lead_id=c.id
LEFT JOIN assignment_history ON assignment_history.lead_id=c.id
LEFT JOIN ai_calls ON ai_calls.lead_id=c.id
LEFT JOIN calls ON calls.lead_id=c.id;
$$;
REVOKE ALL ON FUNCTION public.lead_cleanup_fingerprints(uuid[]) FROM PUBLIC,anon,authenticated;

-- Match the single-record protection helper, using shared normalized phone sets
-- rather than executing separate applicant/student searches for every lead.
CREATE OR REPLACE FUNCTION public.lead_cleanup_protections(_lead_ids uuid[])
RETURNS TABLE(lead_id uuid,reason text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH candidates AS MATERIALIZED (SELECT * FROM public.leads WHERE id=ANY(_lead_ids)),
phones AS MATERIALIZED (
 SELECT DISTINCT phone FROM (
 SELECT public.cleanup_phone(a.phone) AS phone FROM public.applications a
 UNION ALL SELECT public.cleanup_phone(s.phone) FROM public.students s
 UNION ALL SELECT public.cleanup_phone(s.father_phone) FROM public.students s
 UNION ALL SELECT public.cleanup_phone(s.mother_phone) FROM public.students s
 UNION ALL SELECT public.cleanup_phone(s.guardian_phone) FROM public.students s
 ) p WHERE phone IS NOT NULL
),
app_links AS (SELECT DISTINCT a.lead_id FROM public.applications a WHERE a.lead_id IS NOT NULL),
student_links AS (SELECT DISTINCT s.lead_id FROM public.students s WHERE s.lead_id IS NOT NULL),
payment_links AS (SELECT p.lead_id FROM public.lead_payments p UNION SELECT p.lead_id FROM public.payment_links p)
SELECT l.id,CASE
 WHEN l.application_id IS NOT NULL OR a.lead_id IS NOT NULL THEN 'application'
 WHEN s.lead_id IS NOT NULL THEN 'student'
 WHEN l.admission_no IS NOT NULL OR l.pre_admission_no IS NOT NULL OR l.legacy_admission_no IS NOT NULL
    OR l.legacy_pre_admission_no IS NOT NULL OR l.admitted_at IS NOT NULL OR l.applied_at IS NOT NULL
    OR l.stage::text IN ('application_in_progress','application_submitted','application_fee_paid','application_approved',
      'interview','offer_sent','token_paid','pre_admitted','admitted','waitlisted')
    OR (l.application_progress IS NOT NULL AND l.application_progress NOT IN ('{}'::jsonb,'null'::jsonb))
    OR coalesce(l.person_role,'lead')<>'lead' THEN 'admission'
 WHEN p.lead_id IS NOT NULL OR coalesce(l.token_amount,0)>0 THEN 'payment'
 WHEN ph.phone IS NOT NULL THEN 'possible_applicant_student_phone'
 ELSE NULL END
FROM candidates l LEFT JOIN app_links a ON a.lead_id=l.id
LEFT JOIN student_links s ON s.lead_id=l.id LEFT JOIN payment_links p ON p.lead_id=l.id
LEFT JOIN phones ph ON ph.phone=public.cleanup_phone(l.phone);
$$;
REVOKE ALL ON FUNCTION public.lead_cleanup_protections(uuid[]) FROM PUBLIC,anon,authenticated;

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
 WITH candidate_ids AS MATERIALIZED (
 SELECT coalesce(array_agg(l.id),'{}'::uuid[]) AS ids FROM public.leads l
 WHERE (l.created_at<_cutoff OR l.counsellor_id IS NOT NULL) AND l.archived_at IS NULL
 ), protections AS MATERIALIZED (
 SELECT p.* FROM candidate_ids c CROSS JOIN LATERAL public.lead_cleanup_protections(c.ids) p
 ), snapshots AS MATERIALIZED (
 SELECT s.* FROM candidate_ids c CROSS JOIN LATERAL public.lead_cleanup_fingerprints(c.ids) s
 ), base AS MATERIALIZED (
 SELECT l.*, p.reason AS protection,
   coalesce(i.type,CASE WHEN l.lead_institution_type='school' THEN 'school' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.institutions ci WHERE ci.campus_id=l.campus_id AND ci.type='school') THEN 'school' END,
 CASE WHEN EXISTS(SELECT 1 FROM public.jd_category_mappings jm WHERE lower(jm.category)=lower(l.jd_category) AND jm.is_school) THEN 'school' END,'college') AS institution_type, d.institution_id,
   (SELECT calls.disposition FROM (SELECT cl.disposition,cl.called_at AS at,cl.id FROM public.call_logs cl WHERE cl.lead_id=l.id AND cl.disposition IS NOT NULL
 UNION ALL SELECT a.disposition,coalesce(a.completed_at,a.created_at),a.id FROM public.ai_call_records a WHERE a.lead_id=l.id AND a.disposition IS NOT NULL) calls ORDER BY calls.at DESC,calls.id DESC LIMIT 1) AS latest_disposition,
   EXISTS(SELECT 1 FROM public.lead_followups f WHERE f.lead_id=l.id AND f.status='pending' AND f.type IS DISTINCT FROM 'cold_followup') AS human_followup
 FROM public.leads l JOIN protections p ON p.lead_id=l.id LEFT JOIN public.courses c ON c.id=l.course_id
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
 s.fingerprint
 FROM ranked r JOIN snapshots s ON s.lead_id=r.id ORDER BY r.created_at,r.id;
END;
$$;

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
 -- Insert the exact same audit snapshots in one set-based operation.
 INSERT INTO public.lead_cleanup_items(run_id,lead_id,action,reason,destination,before_state,status)
 SELECT run,(item->>'lead_id')::uuid,item->>'action',item->>'reason',(item->>'destination')::uuid,s.snapshot,
   CASE WHEN item->>'action' IN ('protected','review') THEN item->>'action' ELSE 'pending' END
 FROM jsonb_array_elements(plan->'items') item
 JOIN public.lead_cleanup_snapshots(ARRAY(SELECT (x->>'lead_id')::uuid FROM jsonb_array_elements(plan->'items') x)) s
 ON s.lead_id=(item->>'lead_id')::uuid;
 RETURN run;
END;
$$;

-- PostgREST reads function-level timeouts before executing the RPC. Only these
-- permission-checked administrative operations get the bounded exemption.
ALTER FUNCTION public.preview_lead_cleanup(timestamptz) SET statement_timeout='55s';
ALTER FUNCTION public.prepare_lead_cleanup(timestamptz,text) SET statement_timeout='55s';
NOTIFY pgrst,'reload schema';
