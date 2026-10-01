-- Allow an AI-called applicant who has paid the token requirement to receive a PAN.

-- Enforce inactive-student protection at the database boundary as well as in
-- the recompute path. Existing numbers are left untouched; only newly assigned
-- PANs/ANs are blocked while the candidate has an inactive linked student.
CREATE OR REPLACE FUNCTION public.guard_inactive_student_number_issuance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $guard$
DECLARE
  v_issuing_number boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_issuing_number := NEW.pre_admission_no IS NOT NULL OR NEW.admission_no IS NOT NULL;
  ELSE
    v_issuing_number :=
      (NEW.pre_admission_no IS NOT NULL AND NEW.pre_admission_no IS DISTINCT FROM OLD.pre_admission_no)
      OR (NEW.admission_no IS NOT NULL AND NEW.admission_no IS DISTINCT FROM OLD.admission_no);
  END IF;

  IF NOT v_issuing_number THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.login_disabled, false)
     OR NEW.archived_at IS NOT NULL
     OR NEW.deleted_at IS NOT NULL
     OR (NEW.lead_id IS NOT NULL AND public.lead_excluded_from_an_generation(NEW.lead_id)) THEN
    RAISE EXCEPTION 'Cannot issue PAN/AN: linked student is archived, deleted, or login-disabled'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.guard_inactive_lead_number_issuance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $guard$
DECLARE
  v_issuing_number boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_issuing_number := NEW.pre_admission_no IS NOT NULL OR NEW.admission_no IS NOT NULL;
  ELSE
    v_issuing_number :=
      (NEW.pre_admission_no IS NOT NULL AND NEW.pre_admission_no IS DISTINCT FROM OLD.pre_admission_no)
      OR (NEW.admission_no IS NOT NULL AND NEW.admission_no IS DISTINCT FROM OLD.admission_no);
  END IF;

  IF v_issuing_number AND public.lead_excluded_from_an_generation(NEW.id) THEN
    RAISE EXCEPTION 'Cannot issue PAN/AN: linked student is archived, deleted, or login-disabled'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS guard_inactive_student_number_issuance ON public.students;
CREATE TRIGGER guard_inactive_student_number_issuance
  BEFORE INSERT OR UPDATE OF pre_admission_no, admission_no ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_inactive_student_number_issuance();

DROP TRIGGER IF EXISTS guard_inactive_lead_number_issuance ON public.leads;
CREATE TRIGGER guard_inactive_lead_number_issuance
  BEFORE INSERT OR UPDATE OF pre_admission_no, admission_no ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.guard_inactive_lead_number_issuance();

CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_student_id    uuid;
  v_is_school     boolean;
  v_session_name  text;
  v_st            text;
  v_ht            text;
  v_tz            text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  SELECT student_type, hostel_type, transport_zone
    INTO v_st, v_ht, v_tz
    FROM public.offer_letters
   WHERE lead_id = _lead_id AND approval_status = 'approved'
   ORDER BY created_at DESC LIMIT 1;

  IF (v_status->>'token_complete')::boolean
     AND NOT public.lead_excluded_from_an_generation(v_lead.id)
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','ai_called','counsellor_call','visit_scheduled','interview',
                          'application_in_progress','application_fee_paid','application_submitted') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      v_is_school := public.student_course_is_school(v_lead.course_id);

      IF v_is_school THEN
        SELECT name INTO v_session_name FROM public.admission_sessions WHERE id = v_lead.session_id;

        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status,
          admission_date, joining_academic_year,
          student_type, hostel_type, transport_zone, transport_required
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted',
          CURRENT_DATE, COALESCE(v_session_name, to_char(CURRENT_DATE, 'YYYY')),
          COALESCE(v_st, 'day_scholar'), v_ht, v_tz, (v_tz IS NOT NULL)
        ) RETURNING id INTO v_student_id;
      ELSE
        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted'
        ) RETURNING id INTO v_student_id;
      END IF;
    ELSE
      UPDATE public.students
         SET pre_admission_no = COALESCE(pre_admission_no, v_pan),
             status = COALESCE(status, 'pre_admitted')
       WHERE id = v_student_id;
      SELECT pre_admission_no INTO v_pan FROM public.students WHERE id = v_student_id;
    END IF;

    UPDATE public.leads SET pre_admission_no = v_pan, stage = 'token_paid' WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion', 'Token fee complete — Pre-admitted with PAN: ' || v_pan, 'token_paid');

    PERFORM public.fn_notify_event('pan_issued', v_lead.id, jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  IF public.student_course_is_school(v_lead.course_id) THEN
    UPDATE public.students
       SET student_type      = COALESCE(v_st, student_type, 'day_scholar'),
           hostel_type        = v_ht,
           transport_zone     = v_tz,
           transport_required = (v_tz IS NOT NULL)
     WHERE lead_id = v_lead.id;
  END IF;

  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_excluded_from_an_generation(v_lead.id) THEN
      RETURN;
    END IF;

    IF NOT public.lead_docs_ready_for_admission(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN pending — mandatory documents are not all verified. See Inbox → Pending AN Generation.');
      PERFORM public.notify_pending_an_generation(v_lead.id);
      RETURN;
    END IF;

    PERFORM public.fn_issue_admission_no(v_lead.id);
  END IF;
END;
$fn$;
