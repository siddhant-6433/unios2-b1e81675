-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260727134425 name=fix_recompute_school_student_insert applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Fix: recompute_lead_fee_stage student INSERT didn't include admission_date
-- or joining_academic_year, which school-course students require.
-- Now checks student_course_is_school and supplies defaults when true.

CREATE OR REPLACE FUNCTION public.recompute_lead_fee_stage(_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status        jsonb;
  v_lead          public.leads%ROWTYPE;
  v_pan           text;
  v_an            text;
  v_student_id    uuid;
  v_token         text;
  v_is_school     boolean;
  v_session_name  text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_status := public.lead_fee_status(_lead_id);

  -- Token complete: PAN + student row + notify pan_issued -----------------
  IF (v_status->>'token_complete')::boolean
     AND v_lead.pre_admission_no IS NULL
     AND v_lead.stage IN ('offer_sent','counsellor_call','visit_scheduled','interview',
                          'application_in_progress','application_fee_paid','application_submitted') THEN

    v_pan := 'PAN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_lead.id;
    IF v_student_id IS NULL THEN
      v_is_school := public.student_course_is_school(v_lead.course_id);

      IF v_is_school THEN
        SELECT name INTO v_session_name
          FROM public.admission_sessions
         WHERE id = v_lead.session_id;

        INSERT INTO public.students (
          name, phone, email, guardian_name, guardian_phone,
          course_id, campus_id, lead_id, session_id,
          pre_admission_no, status,
          admission_date, joining_academic_year
        ) VALUES (
          v_lead.name, v_lead.phone, v_lead.email,
          v_lead.guardian_name, v_lead.guardian_phone,
          v_lead.course_id, v_lead.campus_id, v_lead.id, v_lead.session_id,
          v_pan, 'pre_admitted',
          CURRENT_DATE, COALESCE(v_session_name, to_char(CURRENT_DATE, 'YYYY'))
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

    UPDATE public.leads
       SET pre_admission_no = v_pan,
           stage = 'token_paid'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            'Token fee complete — Pre-admitted with PAN: ' || v_pan,
            'token_paid');

    PERFORM public.fn_notify_event('pan_issued', v_lead.id,
      jsonb_build_object('pre_admission_no', v_pan));

    SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  END IF;

  -- 25% threshold: AN + magic token --------------------------------------
  IF (v_status->>'twenty_five_complete')::boolean
     AND v_lead.admission_no IS NULL
     AND v_lead.pre_admission_no IS NOT NULL THEN

    IF public.lead_has_rejected_doc(v_lead.id) THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'AN provisioning blocked — one or more documents are rejected. Resolve rejections to issue AN.');
      RETURN;
    END IF;

    v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

    UPDATE public.students
       SET admission_no = COALESCE(admission_no, v_an),
           status = 'active'
     WHERE lead_id = v_lead.id
     RETURNING admission_no, id INTO v_an, v_student_id;

    UPDATE public.leads
       SET admission_no = v_an,
           stage = 'admitted'
     WHERE id = v_lead.id;

    INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
    VALUES (v_lead.id, 'conversion',
            '25% fee paid — Admitted with AN: ' || v_an,
            'admitted');

    IF v_student_id IS NOT NULL THEN
      INSERT INTO public.student_magic_tokens (
        student_id, lead_id, phone, email, expires_at
      ) VALUES (
        v_student_id, v_lead.id, v_lead.phone, v_lead.email,
        now() + interval '30 days'
      )
      RETURNING token INTO v_token;

      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (v_lead.id, 'system',
              'Student-portal claim link generated (valid 30 days).');
    END IF;
  END IF;
END;
$$;
