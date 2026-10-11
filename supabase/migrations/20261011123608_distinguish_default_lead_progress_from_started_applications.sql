-- The production default records four false flags, not an application attempt.
-- Only this known empty state is exempt; unknown progress shapes stay protected.
CREATE OR REPLACE FUNCTION public.lead_cleanup_has_application_progress(_progress jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(_progress NOT IN ('{}'::jsonb,'null'::jsonb,
   '{"personal_details":false,"education_details":false,"application_fee_paid":false,"documents_uploaded":false}'::jsonb),false);
$$;
REVOKE ALL ON FUNCTION public.lead_cleanup_has_application_progress(jsonb) FROM PUBLIC,anon,authenticated;


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
    OR public.lead_cleanup_has_application_progress(l.application_progress)
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
    OR public.lead_cleanup_has_application_progress(l.application_progress)
    OR coalesce(l.person_role,'lead')<>'lead' THEN 'admission'
 WHEN p.lead_id IS NOT NULL OR coalesce(l.token_amount,0)>0 THEN 'payment'
 WHEN ph.phone IS NOT NULL THEN 'possible_applicant_student_phone'
 ELSE NULL END
FROM candidates l LEFT JOIN app_links a ON a.lead_id=l.id
LEFT JOIN student_links s ON s.lead_id=l.id LEFT JOIN payment_links p ON p.lead_id=l.id
LEFT JOIN phones ph ON ph.phone=public.cleanup_phone(l.phone);
$$;

CREATE OR REPLACE FUNCTION public.guard_cleanup_archive() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.archived_at IS NOT NULL OR NEW.archive_reason IS NOT NULL OR NEW.cleanup_run_id IS NOT NULL THEN
     RAISE EXCEPTION 'New leads cannot be inserted as archived';
   END IF;
   IF EXISTS(SELECT 1 FROM public.lead_cleanup_policy WHERE NEW.created_at>=cutoff)
      AND public.lead_cleanup_protection(NEW.id)='missing' AND coalesce(NEW.person_role,'lead')='lead'
      AND NEW.application_id IS NULL AND NEW.admission_no IS NULL AND NEW.pre_admission_no IS NULL
      AND NOT public.lead_cleanup_has_application_progress(NEW.application_progress)
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

NOTIFY pgrst,'reload schema';
