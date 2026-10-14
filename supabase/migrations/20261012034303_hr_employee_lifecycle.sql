-- keep-migration-version: restored production migration 20261012034303; preserve its applied version.
-- Durable onboarding, verified offers and provider account operations.
ALTER TABLE public.employee_profiles ADD COLUMN IF NOT EXISTS employee_timezone text NOT NULL DEFAULT 'Asia/Kolkata',
 ADD COLUMN IF NOT EXISTS workspace_user_id text, ADD COLUMN IF NOT EXISTS workspace_status text NOT NULL DEFAULT 'unconfigured',
 ADD COLUMN IF NOT EXISTS workspace_error text, ADD COLUMN IF NOT EXISTS workspace_synced_at timestamptz;
ALTER TABLE public.employee_exits ADD COLUMN IF NOT EXISTS access_cutoff_at timestamptz;
UPDATE public.employee_exits x SET access_cutoff_at=((x.last_working_day+1)::timestamp AT TIME ZONE e.employee_timezone)
 FROM public.employee_profiles e WHERE x.employee_profile_id=e.id AND x.last_working_day IS NOT NULL AND x.access_cutoff_at IS NULL;

CREATE TABLE IF NOT EXISTS public.hr_workspace_settings(
 id boolean PRIMARY KEY DEFAULT true CHECK(id), domain text NOT NULL DEFAULT '',
 delegated_admin text NOT NULL DEFAULT '', org_unit_path text NOT NULL DEFAULT '/', enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.hr_workspace_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.hr_account_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id),
 action text NOT NULL CHECK(action IN ('enable','suspend')),status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','processing','failed','succeeded','cancelled')),
 payload jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, claim_token uuid,
 error text,provider_user_id text,created_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS hr_account_jobs_open ON public.hr_account_jobs(employee_profile_id,action) WHERE status IN ('pending','processing','failed');
CREATE TABLE IF NOT EXISTS public.hr_employee_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id),
 exit_id uuid REFERENCES employee_exits(id),title text NOT NULL,document_code text,
 asset_assignment_id uuid REFERENCES asset_assignments(id),owner_user_id uuid REFERENCES auth.users(id),required boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','completed','rejected')),
 evidence text,due_on date,completed_by uuid REFERENCES auth.users(id),completed_at timestamptz,
 reminded_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hr_employee_tasks_employee ON public.hr_employee_tasks(employee_profile_id,exit_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS hr_employee_tasks_document ON public.hr_employee_tasks(employee_profile_id,document_code) WHERE exit_id IS NULL AND document_code IS NOT NULL;

ALTER TABLE public.hr_letter_templates ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.hr_letters ADD COLUMN IF NOT EXISTS offer_details jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS template_version integer, ADD COLUMN IF NOT EXISTS offer_version integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now()+interval '14 days'),
 ADD COLUMN IF NOT EXISTS superseded_at timestamptz, ADD COLUMN IF NOT EXISTS acceptance_verified_at timestamptz,
 ADD COLUMN IF NOT EXISTS acceptance_evidence jsonb;
CREATE TABLE IF NOT EXISTS public.hr_portal_verification(
 letter_id uuid PRIMARY KEY REFERENCES hr_letters(id) ON DELETE CASCADE,code_hash text,
 expires_at timestamptz,attempts integer NOT NULL DEFAULT 0,sent_at timestamptz,
 hour_start timestamptz NOT NULL DEFAULT now(),sent_count integer NOT NULL DEFAULT 1,
 session_hash text,session_expires_at timestamptz,verified_at timestamptz);
CREATE TABLE IF NOT EXISTS public.hr_delivery_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_profile_id uuid REFERENCES employee_profiles(id),
 letter_id uuid REFERENCES hr_letters(id),channel text NOT NULL,status text NOT NULL,
 provider_id text,error text,created_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hr_workspace_settings','hr_account_jobs','hr_employee_tasks','hr_portal_verification','hr_delivery_log'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('DROP POLICY IF EXISTS active_account_required ON public.%I',t);
  EXECUTE format('CREATE POLICY active_account_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.is_account_active(auth.uid())) WITH CHECK(public.is_account_active(auth.uid()))',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS hr_workspace_read ON hr_workspace_settings;
CREATE POLICY hr_workspace_read ON hr_workspace_settings FOR SELECT TO authenticated USING(public.has_permission(auth.uid(),'hr:employees_edit'));
DROP POLICY IF EXISTS hr_workspace_write ON hr_workspace_settings;
CREATE POLICY hr_workspace_write ON hr_workspace_settings FOR ALL TO authenticated USING(public.has_role(auth.uid(),'super_admin')) WITH CHECK(public.has_role(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS hr_account_jobs_read ON hr_account_jobs;
CREATE POLICY hr_account_jobs_read ON hr_account_jobs FOR SELECT TO authenticated USING(public.has_permission(auth.uid(),'hr:employees_edit'));
DROP POLICY IF EXISTS hr_delivery_read ON hr_delivery_log;
CREATE POLICY hr_delivery_read ON hr_delivery_log FOR SELECT TO authenticated USING(public.has_permission(auth.uid(),'hr:employees_edit') OR public.has_permission(auth.uid(),'hr:recruitment_edit'));
DROP POLICY IF EXISTS hr_tasks_read ON hr_employee_tasks;
CREATE POLICY hr_tasks_read ON hr_employee_tasks FOR SELECT TO authenticated USING(public.has_permission(auth.uid(),'hr:employees_edit') OR owner_user_id=auth.uid() OR EXISTS(SELECT 1 FROM employee_profiles WHERE id=employee_profile_id AND user_id=auth.uid()));
DROP POLICY IF EXISTS hr_tasks_write ON hr_employee_tasks;
CREATE POLICY hr_tasks_write ON hr_employee_tasks FOR ALL TO authenticated USING(public.has_permission(auth.uid(),'hr:employees_edit')) WITH CHECK(public.has_permission(auth.uid(),'hr:employees_edit'));
GRANT SELECT,INSERT,UPDATE ON hr_workspace_settings TO authenticated;
GRANT SELECT ON hr_account_jobs,hr_delivery_log TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON hr_employee_tasks TO authenticated;

CREATE OR REPLACE FUNCTION public.is_account_active(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _user_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=_user_id AND (login_disabled OR archived_at IS NOT NULL OR deleted_at IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM employee_exits x JOIN employee_profiles e ON e.id=x.employee_profile_id
  WHERE e.user_id=_user_id AND x.status<>'reverted' AND x.access_cutoff_at<=now());
$$;

CREATE OR REPLACE FUNCTION public.hr_exit_cutoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tz text;
BEGIN
 SELECT employee_timezone INTO tz FROM employee_profiles WHERE id=NEW.employee_profile_id;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=tz) THEN RAISE EXCEPTION 'Invalid employee timezone'; END IF;
 IF NEW.last_working_day IS NOT NULL AND (TG_OP='INSERT' OR NEW.last_working_day IS DISTINCT FROM OLD.last_working_day) AND
  (NEW.access_cutoff_at IS NULL OR (TG_OP='UPDATE' AND NEW.access_cutoff_at IS NOT DISTINCT FROM OLD.access_cutoff_at)) THEN
  NEW.access_cutoff_at:=((NEW.last_working_day+1)::timestamp AT TIME ZONE tz);
 END IF;
 IF NEW.access_cutoff_at>GREATEST(((NEW.last_working_day+1)::timestamp AT TIME ZONE tz),now()) THEN RAISE EXCEPTION 'Cutoff must not be later than the end of the last working day'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_exit_cutoff ON public.employee_exits;
CREATE TRIGGER hr_exit_cutoff BEFORE INSERT OR UPDATE ON employee_exits FOR EACH ROW EXECUTE FUNCTION hr_exit_cutoff();

-- Completion is clearance, not an instruction to cut access before the scheduled instant.
CREATE OR REPLACE FUNCTION public.close_due_employee_exits_internal()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE x record; n integer:=0;
BEGIN
 FOR x IN SELECT ex.*,e.user_id FROM employee_exits ex JOIN employee_profiles e ON e.id=ex.employee_profile_id
 WHERE ex.status<>'reverted' AND ex.access_cutoff_at<=now() AND
  (e.workspace_status<>'suspended' OR EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=e.user_id AND NOT p.login_disabled))
 FOR UPDATE OF ex LOOP
  UPDATE profiles SET login_disabled=true WHERE user_id=x.user_id;
  UPDATE auth.users SET banned_until=now()+interval '876000 hours' WHERE id=x.user_id;
  DELETE FROM auth.sessions WHERE user_id=x.user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id=x.user_id::text;
  INSERT INTO hr_account_jobs(employee_profile_id,action,payload)
   VALUES(x.employee_profile_id,'suspend',jsonb_build_object('exit_id',x.id))
   ON CONFLICT(employee_profile_id,action) WHERE status IN ('pending','processing','failed') DO NOTHING;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION close_due_employee_exits_internal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION close_due_employee_exits_internal() TO service_role;

CREATE OR REPLACE FUNCTION public.hr_claim_account_job(_job_id uuid DEFAULT NULL)
RETURNS SETOF public.hr_account_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN QUERY UPDATE hr_account_jobs SET status='processing',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid()
 WHERE id=(SELECT id FROM hr_account_jobs WHERE (_job_id IS NULL OR id=_job_id)
 AND ((status IN ('pending','failed') AND next_attempt_at<=now()) OR (status='processing' AND claimed_at<now()-interval '5 minutes'))
 ORDER BY CASE WHEN action='suspend' THEN 0 ELSE 1 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION hr_claim_account_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_claim_account_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_prepare_access(_employee_id uuid,_email text,_role text,_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e employee_profiles; j uuid; cfg hr_workspace_settings; current_job hr_account_jobs;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.has_permission(_actor,'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF _role NOT IN ('principal','vice_principal','admission_head','hr_executive','counsellor','accountant','faculty','teacher','data_entry','office_admin','office_assistant','school_coordinator','hostel_warden','librarian') THEN RAISE EXCEPTION 'Role cannot be provisioned'; END IF;
 SELECT * INTO e FROM employee_profiles WHERE id=_employee_id FOR UPDATE;
 IF NOT FOUND OR e.verification_status<>'verified' THEN RAISE EXCEPTION 'Employee must be verified'; END IF;
 IF EXISTS(SELECT 1 FROM employee_exits WHERE employee_profile_id=e.id AND status<>'reverted') THEN RAISE EXCEPTION 'Resolve the employee exit before reactivating access'; END IF;
 IF e.job_applicant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=e.job_applicant_id AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND superseded_at IS NULL) THEN RAISE EXCEPTION 'Verified offer acceptance required'; END IF;
 IF EXISTS(SELECT 1 FROM employee_document_types t WHERE t.is_active AND t.is_mandatory AND NOT EXISTS(SELECT 1 FROM employee_documents d WHERE d.employee_id=e.id AND d.doc_key=t.code AND d.status='verified' AND (d.expires_on IS NULL OR d.expires_on>=current_date))) THEN RAISE EXCEPTION 'Verify mandatory employee documents first'; END IF;
 IF EXISTS(SELECT 1 FROM hr_employee_tasks WHERE employee_profile_id=e.id AND exit_id IS NULL AND required AND status<>'completed') THEN RAISE EXCEPTION 'Required onboarding tasks are incomplete'; END IF;
 SELECT * INTO cfg FROM hr_workspace_settings WHERE id;
 IF NOT cfg.enabled OR cfg.domain='' THEN RAISE EXCEPTION 'Configure Workspace automation first'; END IF;
 IF lower(_email) !~ '^[a-z0-9._+-]+@[a-z0-9.-]+$' OR lower(split_part(_email,'@',2))<>lower(cfg.domain) THEN RAISE EXCEPTION 'Confirm an email in the configured Workspace domain'; END IF;
 IF EXISTS(SELECT 1 FROM employee_profiles WHERE id<>e.id AND lower(work_email)=lower(_email)) THEN RAISE EXCEPTION 'Email belongs to another employee'; END IF;
 SELECT * INTO current_job FROM hr_account_jobs WHERE employee_profile_id=e.id AND action='enable' AND status='processing';
 IF FOUND AND current_job.payload IS DISTINCT FROM jsonb_build_object('email',lower(_email),'role',_role) THEN RAISE EXCEPTION 'A different access operation is processing. Wait for its outcome.'; END IF;
 UPDATE employee_profiles SET work_email=lower(_email),workspace_status='pending',workspace_error=NULL WHERE id=e.id;
 UPDATE profiles SET login_disabled=true WHERE user_id=e.user_id;
 UPDATE auth.users SET banned_until=now()+interval '876000 hours' WHERE id=e.user_id;
 INSERT INTO hr_account_jobs(employee_profile_id,action,payload,created_by) VALUES(e.id,'enable',jsonb_build_object('email',lower(_email),'role',_role),_actor)
 ON CONFLICT(employee_profile_id,action) WHERE status IN ('pending','processing','failed') DO UPDATE
 SET status=CASE WHEN hr_account_jobs.status='processing' THEN 'processing' ELSE 'pending' END,
 next_attempt_at=now(),error=NULL,payload=EXCLUDED.payload,created_by=EXCLUDED.created_by
 RETURNING id INTO j;
 RETURN j;
END $$;
REVOKE ALL ON FUNCTION hr_prepare_access(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_prepare_access(uuid,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.hr_advance_onboarding(_employee_id uuid,_stage text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e employee_profiles;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO e FROM employee_profiles WHERE id=_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee missing'; END IF;
 IF _stage IN ('offer_accepted','login_created','employee') AND e.job_applicant_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=e.job_applicant_id AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND superseded_at IS NULL) THEN RAISE EXCEPTION 'Candidate must verify and accept the offer'; END IF;
 IF _stage IN ('login_created','employee') AND (e.user_id IS NULL OR e.workspace_status<>'active' OR NOT is_account_active(e.user_id)) THEN RAISE EXCEPTION 'Enable employee access first'; END IF;
 IF _stage='employee' AND (e.verification_status<>'verified' OR EXISTS(SELECT 1 FROM hr_employee_tasks WHERE employee_profile_id=e.id AND exit_id IS NULL AND required AND status<>'completed')) THEN RAISE EXCEPTION 'Complete verification and required tasks first'; END IF;
 UPDATE employee_profiles SET onboarding_stage=_stage WHERE id=e.id;
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION hr_advance_onboarding(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_advance_onboarding(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_validate_onboarding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.employee_timezone) THEN RAISE EXCEPTION 'Invalid employee timezone'; END IF;
 IF TG_OP='UPDATE' AND COALESCE(auth.role(),'')<>'service_role' AND
 (NEW.workspace_user_id,NEW.workspace_status,NEW.workspace_error,NEW.workspace_synced_at) IS DISTINCT FROM(OLD.workspace_user_id,OLD.workspace_status,OLD.workspace_error,OLD.workspace_synced_at) THEN RAISE EXCEPTION 'Use the Workspace account workflow'; END IF;
 IF TG_OP='UPDATE' AND NEW.onboarding_stage IS DISTINCT FROM OLD.onboarding_stage
 AND NEW.onboarding_stage IN ('login_created','employee') THEN
  IF NEW.user_id IS NULL OR NEW.workspace_status<>'active' OR NOT is_account_active(NEW.user_id) THEN RAISE EXCEPTION 'Enable employee access first'; END IF;
  IF NEW.verification_status<>'verified' THEN RAISE EXCEPTION 'Verify the employee first'; END IF;
  IF NEW.job_applicant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=NEW.job_applicant_id AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND superseded_at IS NULL) THEN RAISE EXCEPTION 'Verified offer acceptance required'; END IF;
  IF EXISTS(SELECT 1 FROM hr_employee_tasks WHERE employee_profile_id=NEW.id AND exit_id IS NULL AND required AND status<>'completed') THEN RAISE EXCEPTION 'Required onboarding tasks are incomplete'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_validate_onboarding ON public.employee_profiles;
CREATE TRIGGER hr_validate_onboarding BEFORE INSERT OR UPDATE ON employee_profiles FOR EACH ROW EXECUTE FUNCTION hr_validate_onboarding();

-- Version templates without modifying previously rendered letters.
CREATE OR REPLACE FUNCTION public.hr_template_version()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.body,NEW.subject) IS DISTINCT FROM (OLD.body,OLD.subject) THEN NEW.version:=OLD.version+1; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_template_version ON public.hr_letter_templates;
CREATE TRIGGER hr_template_version BEFORE UPDATE ON hr_letter_templates FOR EACH ROW EXECUTE FUNCTION hr_template_version();

CREATE OR REPLACE FUNCTION public.hr_portal_code(_token uuid,_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l hr_letters; v hr_portal_verification;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO l FROM hr_letters WHERE acceptance_token=_token AND superseded_at IS NULL AND expires_at>now() AND status IN ('approved','issued') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Offer link unavailable'; END IF;
 SELECT * INTO v FROM hr_portal_verification WHERE letter_id=l.id FOR UPDATE;
 IF v.sent_at>now()-interval '60 seconds' OR (v.hour_start>now()-interval '1 hour' AND v.sent_count>=5) THEN RAISE EXCEPTION 'Wait before requesting another code'; END IF;
 INSERT INTO hr_portal_verification(letter_id,code_hash,expires_at,sent_at) VALUES(l.id,_hash,now()+interval '10 minutes',now())
 ON CONFLICT(letter_id) DO UPDATE SET code_hash=_hash,expires_at=now()+interval '10 minutes',attempts=0,sent_at=now(),
 sent_count=CASE WHEN hr_portal_verification.hour_start<now()-interval '1 hour' THEN 1 ELSE hr_portal_verification.sent_count+1 END,
 hour_start=CASE WHEN hr_portal_verification.hour_start<now()-interval '1 hour' THEN now() ELSE hr_portal_verification.hour_start END;
END $$;
CREATE OR REPLACE FUNCTION public.hr_portal_verify(_token uuid,_hash text,_session_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v hr_portal_verification; lid uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT id INTO lid FROM hr_letters WHERE acceptance_token=_token AND superseded_at IS NULL AND expires_at>now();
 SELECT * INTO v FROM hr_portal_verification WHERE letter_id=lid FOR UPDATE;
 IF NOT FOUND OR v.expires_at<=now() OR v.attempts>=5 OR v.code_hash IS NULL THEN RETURN false; END IF;
 UPDATE hr_portal_verification SET attempts=attempts+1 WHERE letter_id=lid;
 IF v.code_hash IS DISTINCT FROM _hash THEN RETURN false; END IF;
 UPDATE hr_portal_verification SET code_hash=NULL,verified_at=now(),session_hash=_session_hash,session_expires_at=now()+interval '30 minutes' WHERE letter_id=lid;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION hr_portal_code(uuid,text),hr_portal_verify(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_portal_code(uuid,text),hr_portal_verify(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.generate_hr_offer_letter(_job_applicant_id uuid, _details jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.hr_letter_templates; a public.job_applicants;
  txt text; sub text; v_id uuid; v_super boolean;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:documents_generate')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  v_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);

  SELECT * INTO t FROM public.hr_letter_templates WHERE code = 'offer' AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer letter template not found'; END IF;
  SELECT * INTO a FROM public.job_applicants WHERE id = _job_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Applicant not found'; END IF;

  PERFORM 1 FROM job_applicants WHERE id=a.id FOR UPDATE;
  IF a.status IN ('withdrawn','rejected','hired') THEN RAISE EXCEPTION 'Candidate is not available for an offer'; END IF;
  IF COALESCE(_details->>'offered_role','')='' OR COALESCE(_details->>'joining_date','')='' THEN RAISE EXCEPTION 'Role and joining date are required'; END IF;
  PERFORM (_details->>'joining_date')::date;
  IF EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=a.id AND acceptance_status='accepted' AND superseded_at IS NULL) THEN RAISE EXCEPTION 'Accepted offer cannot be replaced'; END IF;
  UPDATE hr_letters SET superseded_at=now() WHERE job_applicant_id=a.id AND letter_code='offer' AND superseded_at IS NULL;
  txt := t.body; sub := COALESCE(t.subject, t.name);
  txt := replace(txt, '{{applicant_name}}', COALESCE(a.name, ''));
  txt := replace(txt, '{{offered_role}}',   COALESCE(_details->>'offered_role', a.desired_role, ''));
  txt := replace(txt, '{{offered_ctc}}',    COALESCE(_details->>'offered_ctc', ''));
  txt := replace(txt, '{{joining_date}}',   COALESCE(_details->>'joining_date', ''));
  txt := replace(txt, '{{legal_entity}}',   COALESCE(_details->>'legal_entity', ''));
  txt := replace(txt, '{{today}}',          to_char(CURRENT_DATE, 'DD Mon YYYY'));
  sub := replace(sub, '{{applicant_name}}', COALESCE(a.name, ''));

  INSERT INTO public.hr_letters (
    job_applicant_id, template_id, letter_code, letter_name, subject, body,
    reference_no, issued_by, status, submitted_by, submitted_at, approved_by, approved_at, offer_details, template_version, offer_version
  ) VALUES (
    a.id, t.id, t.code, t.name, sub, txt,
    'HR/OFR/' || to_char(CURRENT_DATE, 'YYYY') || '/' || left(a.id::text, 6),
    auth.uid(),
    CASE WHEN v_super THEN 'approved' ELSE 'pending_approval' END,
    auth.uid(), now(),
    CASE WHEN v_super THEN auth.uid() ELSE NULL END,
    CASE WHEN v_super THEN now() ELSE NULL END, _details, t.version, COALESCE((SELECT max(offer_version)+1 FROM hr_letters WHERE job_applicant_id=a.id),1)
  ) RETURNING id INTO v_id;

  UPDATE job_applicants SET status='offered' WHERE id=a.id;
  PERFORM public.log_hr_document_action(v_id, 'generated', jsonb_build_object('applicant', a.name));
  IF NOT v_super THEN
    PERFORM public.notify_super_admins_hr_document(
      v_id, 'Offer letter pending approval',
      'Offer letter for ' || COALESCE(a.name, 'applicant') || ' awaits approval.');
    PERFORM public.log_hr_document_action(v_id, 'submitted', '{}'::jsonb);
  END IF;
  RETURN v_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.redeem_offer_acceptance(
  _token uuid, _accept boolean, _note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l public.hr_letters;
  a public.job_applicants;
  v_profile uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Verified portal required'; END IF;
  SELECT * INTO l FROM public.hr_letters WHERE acceptance_token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or unknown offer link'; END IF;
  IF l.superseded_at IS NOT NULL OR l.expires_at<=now() OR l.acceptance_verified_at IS NULL THEN RAISE EXCEPTION 'Offer verification expired or offer replaced'; END IF;
  IF l.status NOT IN ('approved', 'issued') THEN RAISE EXCEPTION 'This offer is not available to respond to yet'; END IF;
  IF l.acceptance_status <> 'pending' THEN RAISE EXCEPTION 'You have already responded to this offer'; END IF;

  SELECT * INTO a FROM public.job_applicants WHERE id = l.job_applicant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer is not linked to a candidate'; END IF;

  IF _accept THEN
    UPDATE public.hr_letters
       SET acceptance_status = 'accepted', accepted_at = now(), acceptance_note = _note
     WHERE id = l.id;

    -- Move the candidate into the onboarding pipeline (offer accepted).
    SELECT id INTO v_profile FROM public.employee_profiles WHERE job_applicant_id = a.id LIMIT 1;
    IF v_profile IS NULL THEN
      INSERT INTO public.employee_profiles
        (user_id, display_name, personal_email, mobile_number, job_title,
         onboarding_stage, offer_accepted_at, offer_joining_date, verification_status, job_applicant_id)
      VALUES
        (NULL, a.name, a.email, a.source_phone, COALESCE(l.offer_details->>'offered_role',a.desired_role),
         'offer_accepted', now(), (l.offer_details->>'joining_date')::date, 'pending', a.id);
    ELSE
      UPDATE public.employee_profiles
         SET onboarding_stage = 'offer_accepted', offer_accepted_at = now(), offer_joining_date=(l.offer_details->>'joining_date')::date, job_title=COALESCE(l.offer_details->>'offered_role',job_title)
       WHERE id = v_profile;
    END IF;

    INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
    VALUES (a.id, auth.uid(), 'offer_accepted', 'Candidate accepted the offer' || COALESCE(' · ' || _note, ''));
    RETURN 'accepted';
  END IF;

  UPDATE public.hr_letters
     SET acceptance_status = 'declined', declined_at = now(), acceptance_note = _note
   WHERE id = l.id;
  UPDATE public.job_applicants SET status = 'withdrawn' WHERE id = a.id AND status <> 'hired';

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (a.id, auth.uid(), 'offer_declined', 'Candidate declined the offer' || COALESCE(' · ' || _note, ''));
  RETURN 'declined';
END;
$$;
REVOKE ALL ON FUNCTION redeem_offer_acceptance(uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION redeem_offer_acceptance(uuid,boolean,text) TO service_role;
CREATE OR REPLACE FUNCTION public.hr_portal_accept(_token uuid,_session_hash text,_accept boolean,_note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l hr_letters; result text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO l FROM hr_letters WHERE acceptance_token=_token FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM hr_portal_verification WHERE letter_id=l.id AND session_hash=_session_hash AND session_expires_at>now()) THEN RAISE EXCEPTION 'Verify your identity again'; END IF;
 IF l.acceptance_status=(CASE WHEN _accept THEN 'accepted' ELSE 'declined' END) THEN RETURN l.acceptance_status; END IF;
 UPDATE hr_letters SET acceptance_verified_at=now(),acceptance_evidence=jsonb_build_object('method','otp','verified_at',now(),'offer_version',offer_version) WHERE id=l.id;
 result:=public.redeem_offer_acceptance(_token,_accept,_note);
 IF _accept THEN
  UPDATE employee_profiles SET date_of_joining=(l.offer_details->>'joining_date')::date,
   offer_ctc_annual=NULLIF(l.offer_details->>'offered_ctc','')::numeric
   WHERE job_applicant_id=l.job_applicant_id;
  INSERT INTO hr_employee_tasks(employee_profile_id,title,document_code)
   SELECT e.id,t.name,t.code FROM employee_profiles e CROSS JOIN employee_document_types t
   WHERE e.job_applicant_id=l.job_applicant_id AND t.is_active AND t.is_mandatory
   ON CONFLICT(employee_profile_id,document_code) WHERE exit_id IS NULL AND document_code IS NOT NULL DO NOTHING;
  UPDATE hr_letters SET expires_at=GREATEST(expires_at,now()+interval '30 days') WHERE id=l.id;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION hr_portal_accept(uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_portal_accept(uuid,text,boolean,text) TO service_role;
CREATE OR REPLACE FUNCTION public.get_offer_by_token(_token uuid)
RETURNS TABLE (
  letter_id uuid, applicant_name text, subject text, body text,
  status text, acceptance_status text, reference_no text,
  desired_role text, job_opening_title text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, COALESCE(a.name, 'Candidate'), l.subject, l.body,
         l.status, l.acceptance_status, l.reference_no,
         a.desired_role, jo.title
    FROM public.hr_letters l
    LEFT JOIN public.job_applicants a ON a.id = l.job_applicant_id
    LEFT JOIN public.job_openings jo ON jo.id = a.job_opening_id
   WHERE l.acceptance_token = _token
     AND l.status IN ('approved', 'issued') AND l.expires_at>now() AND l.superseded_at IS NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.hire_job_applicant(
  _applicant_id uuid, _joining_date date DEFAULT NULL, _ctc_annual numeric DEFAULT NULL,
  _job_title text DEFAULT NULL, _department_id uuid DEFAULT NULL, _campus_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_app      public.job_applicants%ROWTYPE;
  v_employee uuid; l public.hr_letters;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_app FROM public.job_applicants WHERE id = _applicant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such applicant'; END IF;

  IF v_app.status IN ('rejected','withdrawn') THEN RAISE EXCEPTION 'Candidate is unavailable'; END IF;
  SELECT * INTO l FROM hr_letters WHERE job_applicant_id=_applicant_id AND letter_code='offer' AND superseded_at IS NULL AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND status IN ('approved','issued') ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verified offer acceptance required'; END IF;
  IF _joining_date IS NOT NULL AND _joining_date IS DISTINCT FROM (l.offer_details->>'joining_date')::date THEN RAISE EXCEPTION 'Joining date differs from accepted offer'; END IF;
  IF _job_title IS NOT NULL AND _job_title IS DISTINCT FROM l.offer_details->>'offered_role' THEN RAISE EXCEPTION 'Role differs from accepted offer'; END IF;
  IF _ctc_annual IS NOT NULL AND _ctc_annual IS DISTINCT FROM NULLIF(l.offer_details->>'offered_ctc','')::numeric THEN RAISE EXCEPTION 'CTC differs from accepted offer'; END IF;
  _joining_date:=(l.offer_details->>'joining_date')::date;
  _job_title:=l.offer_details->>'offered_role';
  _ctc_annual:=NULLIF(l.offer_details->>'offered_ctc','')::numeric;
  SELECT id INTO v_employee FROM public.employee_profiles WHERE job_applicant_id = _applicant_id;

  IF v_employee IS NULL THEN
    INSERT INTO public.employee_profiles (
      display_name, first_name, last_name, mobile_number, personal_email,
      job_title, department_id, campus_id, date_of_joining,
      job_applicant_id, onboarding_stage, employment_status, verification_status
    ) VALUES (
      v_app.name,
      split_part(COALESCE(v_app.name, ''), ' ', 1),
      NULLIF(regexp_replace(COALESCE(v_app.name, ''), '^\S+\s*', ''), ''),
      v_app.source_phone, v_app.email,
      COALESCE(_job_title, v_app.desired_role),
      _department_id, _campus_id, _joining_date,
      _applicant_id, 'offer_accepted', 'Working', 'pending'
    ) RETURNING id INTO v_employee;
  END IF;

  UPDATE public.employee_profiles
     SET date_of_joining=_joining_date,job_title=_job_title,department_id=COALESCE(_department_id,department_id),campus_id=COALESCE(_campus_id,campus_id),offer_joining_date = COALESCE(_joining_date, offer_joining_date),
         offer_ctc_annual   = COALESCE(_ctc_annual, offer_ctc_annual),
         offer_accepted_at  = COALESCE(offer_accepted_at, now()),
         updated_at         = now()
   WHERE id = v_employee;

  UPDATE public.job_applicants SET status = 'hired', updated_at = now() WHERE id = _applicant_id;

  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (_applicant_id, auth.uid(), 'stage',
          'Hired — employee record created. Verify the record and link a login to complete onboarding.');

  RETURN v_employee;
END;
$$;

-- Complete onboarding document tasks only after review; rejection reopens them.
CREATE OR REPLACE FUNCTION public.hr_document_task_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE hr_employee_tasks SET status=CASE WHEN NEW.status='verified' THEN 'completed' WHEN NEW.status='rejected' THEN 'rejected' ELSE 'submitted' END,
 evidence=NEW.id::text,completed_by=NEW.verified_by,completed_at=NEW.verified_at
 WHERE employee_profile_id=NEW.employee_id AND exit_id IS NULL AND document_code=NEW.doc_key;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_document_task_sync ON public.employee_documents;
CREATE TRIGGER hr_document_task_sync AFTER INSERT OR UPDATE ON employee_documents FOR EACH ROW EXECUTE FUNCTION hr_document_task_sync();

-- Securely finish provider work and enable Auth/profile access together.
CREATE OR REPLACE FUNCTION public.hr_finish_account_job(_job_id uuid,_claim uuid,_provider_id text,_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j hr_account_jobs; e employee_profiles;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO j FROM hr_account_jobs WHERE id=_job_id AND status='processing' AND claim_token=_claim;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job claim expired'; END IF;
 SELECT * INTO e FROM employee_profiles WHERE id=j.employee_profile_id FOR UPDATE;
 -- Lock order matches preparation: employee first, then the job claim.
 SELECT * INTO j FROM hr_account_jobs WHERE id=_job_id AND status='processing' AND claim_token=_claim FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job claim expired'; END IF;
 IF j.action='enable' THEN
  IF e.verification_status<>'verified' OR EXISTS(SELECT 1 FROM employee_exits WHERE employee_profile_id=e.id AND status<>'reverted') THEN RAISE EXCEPTION 'Employee is no longer eligible for access'; END IF;
  IF _user_id IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=_user_id) THEN RAISE EXCEPTION 'Login profile missing'; END IF;
  IF e.user_id IS NOT NULL AND e.user_id<>_user_id THEN RAISE EXCEPTION 'Employee login changed'; END IF;
  IF e.work_email IS DISTINCT FROM j.payload->>'email' OR NOT EXISTS(SELECT 1 FROM hr_workspace_settings WHERE enabled AND lower(domain)=lower(split_part(e.work_email,'@',2))) THEN RAISE EXCEPTION 'Workspace configuration changed'; END IF;
  IF NOT has_permission(j.created_by,'hr:employees_edit') THEN RAISE EXCEPTION 'Access requester is no longer authorized'; END IF;
  IF e.job_applicant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=e.job_applicant_id AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND superseded_at IS NULL) THEN RAISE EXCEPTION 'Offer acceptance changed'; END IF;
  IF EXISTS(SELECT 1 FROM employee_profiles WHERE id<>e.id AND user_id=_user_id) THEN RAISE EXCEPTION 'Login linked to another employee'; END IF;
  IF EXISTS(SELECT 1 FROM employee_document_types t WHERE t.is_active AND t.is_mandatory AND NOT EXISTS(SELECT 1 FROM employee_documents d WHERE d.employee_id=e.id AND d.doc_key=t.code AND d.status='verified' AND(d.expires_on IS NULL OR d.expires_on>=current_date))) THEN RAISE EXCEPTION 'Mandatory documents changed'; END IF;
  IF EXISTS(SELECT 1 FROM hr_employee_tasks WHERE employee_profile_id=e.id AND exit_id IS NULL AND required AND status<>'completed') THEN RAISE EXCEPTION 'Onboarding tasks changed'; END IF;
  UPDATE profiles SET login_disabled=false,archived_at=NULL WHERE user_id=_user_id;
  UPDATE auth.users SET banned_until=NULL WHERE id=_user_id;
  UPDATE employee_profiles SET user_id=_user_id,workspace_user_id=_provider_id,workspace_status='active',workspace_error=NULL,workspace_synced_at=now(),onboarding_stage='login_created' WHERE id=e.id;
  INSERT INTO user_roles(user_id,role) VALUES(_user_id,(j.payload->>'role')::app_role) ON CONFLICT(user_id,role) DO NOTHING;
 ELSE
  UPDATE employee_profiles SET workspace_status='suspended',workspace_error=NULL,workspace_synced_at=now() WHERE id=e.id;
 END IF;
 INSERT INTO user_admin_audit_log(target_user_id,target_display_name,action,details,performed_by)
 VALUES(COALESCE(_user_id,e.user_id),e.display_name,CASE WHEN j.action='enable' THEN 'employee_access_enabled' ELSE 'workspace_suspended' END,jsonb_build_object('employee_id',e.id,'job_id',j.id,'workspace_user_id',_provider_id),j.created_by);
 UPDATE hr_account_jobs SET status='succeeded' ,provider_user_id=_provider_id,completed_at=now(),error=NULL WHERE id=j.id;
END $$;
REVOKE ALL ON FUNCTION hr_finish_account_job(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hr_finish_account_job(uuid,uuid,text,uuid) TO service_role;

-- Close access at minute resolution. Data policies enforce the exact timestamp.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 PERFORM cron.schedule('hr-exit-access-cutoff','* * * * *','SELECT public.close_due_employee_exits_internal()');
END IF; END $$;

CREATE OR REPLACE FUNCTION public.hr_dispatch_account_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE url text; secret text;
BEGIN
 SELECT value INTO url FROM _app_config WHERE key='supabase_url';
 SELECT value INTO secret FROM _app_config WHERE key='service_role_key';
 IF url IS NULL OR secret IS NULL THEN RETURN; END IF;
 PERFORM net.http_post(url:=url||'/functions/v1/hr-account-worker',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hr_dispatch_account_worker() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
 PERFORM cron.schedule('hr-account-provider-jobs','* * * * *','SELECT public.hr_dispatch_account_worker()');
END IF; END $$;

CREATE OR REPLACE FUNCTION public.hr_complete_employee_task(_task_id uuid,_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t hr_employee_tasks;
BEGIN
 IF NOT public.is_account_active(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO t FROM hr_employee_tasks WHERE id=_task_id FOR UPDATE;
 IF NOT FOUND OR NOT(public.has_permission(auth.uid(),'hr:employees_edit') OR t.owner_user_id=auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF t.document_code IS NOT NULL THEN RAISE EXCEPTION 'Verify the document to complete this task'; END IF;
 IF t.asset_assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_assignments WHERE id=t.asset_assignment_id AND returned_at IS NOT NULL) THEN RAISE EXCEPTION 'Record the asset return before completing clearance'; END IF;
 IF COALESCE(btrim(_evidence),'')='' THEN RAISE EXCEPTION 'Completion evidence required'; END IF;
 UPDATE hr_employee_tasks SET status='completed',evidence=_evidence,completed_by=auth.uid(),completed_at=now() WHERE id=t.id;
END $$;
REVOKE ALL ON FUNCTION hr_complete_employee_task(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_complete_employee_task(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_employee_exit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND EXISTS(SELECT 1 FROM hr_employee_tasks WHERE exit_id=NEW.id AND required AND status<>'completed') THEN RAISE EXCEPTION 'Complete required exit clearance tasks first'; END IF;
 IF NEW.status='reverted' THEN
  UPDATE employee_profiles SET date_of_exit=NULL,employment_status='Working' WHERE id=NEW.employee_profile_id;
 ELSE
  UPDATE employee_profiles SET date_of_exit=NEW.last_working_day,employment_status=CASE WHEN NEW.access_cutoff_at<=now() THEN CASE WHEN NEW.exit_type='termination' THEN 'Terminated' ELSE 'Resigned' END ELSE 'On Notice' END WHERE id=NEW.employee_profile_id;
  UPDATE hr_account_jobs SET status='cancelled',error='Employee exit recorded' WHERE employee_profile_id=NEW.employee_profile_id AND action='enable' AND status IN ('pending','failed','processing');
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.hr_exit_tasks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status<>'reverted' THEN
  IF TG_OP='INSERT' THEN
   INSERT INTO hr_employee_tasks(employee_profile_id,exit_id,title,owner_user_id)
   VALUES(NEW.employee_profile_id,NEW.id,'Department handover',auth.uid()),(NEW.employee_profile_id,NEW.id,'Document and access clearance',auth.uid());
   INSERT INTO hr_employee_tasks(employee_profile_id,exit_id,title,owner_user_id,asset_assignment_id)
   SELECT NEW.employee_profile_id,NEW.id,'Return asset: '||a.name,auth.uid(),aa.id FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
   WHERE aa.employee_profile_id=NEW.employee_profile_id AND aa.returned_at IS NULL;
  END IF;
  IF NEW.access_cutoff_at<=now() THEN PERFORM public.close_due_employee_exits_internal(); END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS hr_exit_tasks ON public.employee_exits;
CREATE TRIGGER hr_exit_tasks AFTER INSERT OR UPDATE OF access_cutoff_at,status ON employee_exits FOR EACH ROW EXECUTE FUNCTION hr_exit_tasks();

CREATE OR REPLACE FUNCTION public.hr_dashboard(_campus_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d date:=(now() AT TIME ZONE 'Asia/Kolkata')::date; result jsonb;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 WITH staff AS(SELECT * FROM employee_profiles WHERE verification_status='verified'
  AND (date_of_joining IS NULL OR date_of_joining<=d) AND (date_of_exit IS NULL OR date_of_exit>=d)
  AND (employment_status IS NULL OR employment_status IN ('Working','On Notice')) AND (_campus_id IS NULL OR campus_id=_campus_id)),
 punches AS(SELECT a.*,e.display_name FROM employee_attendance a JOIN staff e ON e.user_id=a.user_id WHERE a.date=d),
 leaves AS(SELECT DISTINCT r.employee_profile_id FROM employee_leave_requests r JOIN staff e ON e.id=r.employee_profile_id WHERE r.status='approved' AND d BETWEEN r.start_date AND r.end_date)
 SELECT jsonb_build_object('stats',jsonb_build_object(
  'totalEmployees',(SELECT count(*) FROM staff),'punchedInToday',(SELECT count(DISTINCT user_id) FROM punches),
  'onLeaveToday',(SELECT count(*) FROM leaves),
  'absentToday',(SELECT count(*) FROM staff e WHERE hr_expected_workday(e.id,d) AND NOT EXISTS(SELECT 1 FROM punches p WHERE p.user_id=e.user_id)),
  'pendingLeaves',(SELECT count(*) FROM employee_leave_requests r JOIN staff e ON e.id=r.employee_profile_id WHERE r.status='pending'),
  'pendingFaceRegs',(SELECT count(*) FROM employee_face_registrations f JOIN staff e ON e.user_id=f.user_id WHERE f.status='pending'),
  'newJobApplicants',(SELECT count(*) FROM job_applicants a LEFT JOIN job_openings j ON j.id=a.job_opening_id WHERE a.status='new' AND (_campus_id IS NULL OR j.campus_id=_campus_id))),
  'recentPunches',COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM(SELECT * FROM punches ORDER BY punch_in DESC LIMIT 10) q),'[]'::jsonb),
  'weeklyAttendance',COALESCE((SELECT jsonb_agg(jsonb_build_object('date',day::date,'day',to_char(day,'Dy'),
    'present',(SELECT count(DISTINCT a.user_id) FROM employee_attendance a JOIN employee_profiles e ON e.user_id=a.user_id WHERE a.date=day::date AND (_campus_id IS NULL OR e.campus_id=_campus_id)),
    'absent',(SELECT count(*) FROM employee_profiles e WHERE e.verification_status='verified' AND (_campus_id IS NULL OR e.campus_id=_campus_id) AND hr_expected_workday(e.id,day::date) AND NOT EXISTS(SELECT 1 FROM employee_attendance a WHERE a.user_id=e.user_id AND a.date=day::date))) ORDER BY day)
   FROM generate_series((d-6)::timestamp,d::timestamp,interval '1 day') day),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION hr_dashboard(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_dashboard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_guard_offer_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role' THEN
  IF TG_OP='INSERT' AND(NEW.acceptance_status<>'pending' OR NEW.acceptance_verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Offer acceptance requires verified candidate response'; END IF;
  IF TG_OP='UPDATE' AND (NEW.acceptance_status,NEW.acceptance_verified_at,NEW.acceptance_evidence) IS DISTINCT FROM (OLD.acceptance_status,OLD.acceptance_verified_at,OLD.acceptance_evidence) THEN RAISE EXCEPTION 'Offer acceptance requires verified candidate response'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('approved','issued') AND(NEW.body,NEW.subject,NEW.offer_details,NEW.template_version) IS DISTINCT FROM(OLD.body,OLD.subject,OLD.offer_details,OLD.template_version) THEN RAISE EXCEPTION 'Approved offer terms are immutable; generate a new version'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_guard_offer_evidence ON public.hr_letters;
CREATE TRIGGER hr_guard_offer_evidence BEFORE INSERT OR UPDATE ON hr_letters FOR EACH ROW EXECUTE FUNCTION hr_guard_offer_evidence();

CREATE OR REPLACE FUNCTION public.hr_guard_hired_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW.status='hired' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'hired') AND NOT EXISTS(SELECT 1 FROM hr_letters WHERE job_applicant_id=NEW.id AND acceptance_status='accepted' AND acceptance_verified_at IS NOT NULL AND superseded_at IS NULL AND status IN('approved','issued')) THEN RAISE EXCEPTION 'Verified offer acceptance required'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_guard_hired_status ON public.job_applicants;
CREATE TRIGGER hr_guard_hired_status BEFORE INSERT OR UPDATE OF status ON job_applicants FOR EACH ROW EXECUTE FUNCTION hr_guard_hired_status();

CREATE OR REPLACE FUNCTION public.hr_dispatch_onboarding_reminders()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE url text; secret text; e record;
BEGIN
 SELECT value INTO url FROM _app_config WHERE key='supabase_url'; SELECT value INTO secret FROM _app_config WHERE key='service_role_key';
 IF url IS NULL OR secret IS NULL THEN RETURN; END IF;
 FOR e IN SELECT DISTINCT t.employee_profile_id FROM hr_employee_tasks t JOIN employee_profiles p ON p.id=t.employee_profile_id
 WHERE t.exit_id IS NULL AND t.status<>'completed' AND p.job_applicant_id IS NOT NULL
 AND(p.date_of_exit IS NULL OR p.date_of_exit>=current_date) AND COALESCE(t.reminded_at,t.created_at)<now()-interval '3 days' ORDER BY t.employee_profile_id LIMIT 100 LOOP
  PERFORM net.http_post(url:=url||'/functions/v1/hr-onboarding-notify',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:=jsonb_build_object('employee_id',e.employee_profile_id));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION hr_dispatch_onboarding_reminders() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
 PERFORM cron.schedule('hr-onboarding-reminders','0 4 * * *','SELECT public.hr_dispatch_onboarding_reminders()');
END IF; END $$;
