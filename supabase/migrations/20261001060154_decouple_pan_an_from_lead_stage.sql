-- decouple pan an from lead stage
-- Admission identifiers follow admissions facts, not mutable CRM call stages.
-- Issuance requires a submitted/approved application and an approved offer for
-- the lead's course and intake. Rejected, withdrawn, cancelled, draft, and
-- on-hold applications do not qualify. The existing inactive-student guard is
-- retained separately.

CREATE OR REPLACE FUNCTION public.lead_admission_issuance_eligible(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads l
      JOIN LATERAL (
        SELECT a.status, a.session_id
          FROM public.applications a
         WHERE a.lead_id = l.id
         ORDER BY a.created_at DESC NULLS LAST
         LIMIT 1
      ) app ON true
     WHERE l.id = _lead_id
       AND app.status IN ('submitted', 'approved')
       AND (app.session_id IS NULL OR app.session_id = l.session_id)
       AND EXISTS (
         SELECT 1
           FROM public.offer_letters ol
          WHERE ol.lead_id = l.id
            AND ol.approval_status = 'approved'
            AND (ol.course_id IS NULL OR ol.course_id = l.course_id)
            AND (ol.session_id IS NULL OR ol.session_id = l.session_id)
       )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.fn_issue_admission_no(_lead_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_an         text;
  v_student_id uuid;
  v_token      text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.pre_admission_no IS NULL THEN RETURN NULL; END IF;
  IF v_lead.admission_no IS NOT NULL THEN RETURN v_lead.admission_no; END IF;
  IF public.lead_excluded_from_an_generation(_lead_id) THEN
    RAISE EXCEPTION 'Cannot generate AN: student is archived, deleted, or login-disabled';
  END IF;
  IF NOT public.lead_admission_issuance_eligible(_lead_id) THEN
    RAISE EXCEPTION 'Cannot generate AN: a submitted application and approved offer for this course and intake are required';
  END IF;

  v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

  UPDATE public.students SET admission_no = COALESCE(admission_no, v_an), status = 'active'
   WHERE lead_id = v_lead.id RETURNING admission_no, id INTO v_an, v_student_id;

  UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;

  INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
  VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');

  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at)
    VALUES (v_student_id, v_lead.id, v_lead.phone, v_lead.email, now() + interval '30 days')
    RETURNING token INTO v_token;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_lead.id, 'system', 'Student-portal claim link generated (valid 30 days).');
  END IF;

  UPDATE public.applications
     SET admission_doc_status = COALESCE(admission_doc_status, '{}'::jsonb)
                                || jsonb_build_object('held', false)
   WHERE lead_id = v_lead.id
     AND COALESCE((admission_doc_status->>'held')::boolean, false);

  RETURN v_an;
END;
$fn$;

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
     AND (course_id IS NULL OR course_id = v_lead.course_id)
     AND (session_id IS NULL OR session_id = v_lead.session_id)
   ORDER BY created_at DESC LIMIT 1;

  IF (v_status->>'token_complete')::boolean
     AND public.lead_admission_issuance_eligible(v_lead.id)
     AND NOT public.lead_excluded_from_an_generation(v_lead.id)
     AND v_lead.pre_admission_no IS NULL THEN

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
    IF NOT public.lead_admission_issuance_eligible(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system', 'AN pending — a submitted application and approved offer for this course and intake are required.');
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

GRANT EXECUTE ON FUNCTION public.lead_admission_issuance_eligible(uuid) TO authenticated;
