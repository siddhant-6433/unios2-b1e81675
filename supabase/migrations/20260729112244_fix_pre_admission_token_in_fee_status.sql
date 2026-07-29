-- Fix: lead_fee_status was missing 'pre_admission_token' in type filters.
-- The 20260707 migration that added this type never deployed to prod (DB push
-- CI drift). 15 confirmed payments (₹1,30,010) were silently ignored — leads
-- stuck at "awaiting token-fee payment" despite having paid.
--
-- Also fixes recompute_lead_fee_stage: student INSERT now supplies
-- admission_date + joining_academic_year for school courses (required by
-- trg_enforce_school_student_academic_fields).

-- 1. lead_fee_status — add 'pre_admission_token' to type filters ------------

CREATE OR REPLACE FUNCTION public.lead_fee_status(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy            jsonb   := public.lead_fee_policy(_lead_id);
  v_pan_pct           numeric := COALESCE((v_policy->>'pan_threshold_pct')::numeric, 10);
  v_an_pct            numeric := COALESCE((v_policy->>'an_threshold_pct')::numeric, 25);
  v_min_instalment    numeric := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000);
  v_lump_pct          numeric := COALESCE((v_policy->>'lump_sum_first_year_waiver_pct')::numeric, 0);
  v_multi_pct         numeric := COALESCE((v_policy->>'multi_year_waiver_pct')::numeric, 0);
  v_window_days       int     := COALESCE((v_policy->>'multi_year_window_days')::numeric, 0);

  v_first_year        numeric := public.lead_first_year_fee(_lead_id);
  v_post_year_1       numeric := public.lead_post_scholarship_year_1(_lead_id);
  v_total_course      numeric := public.lead_total_course_fee(_lead_id);
  v_additional        numeric := GREATEST(v_total_course - v_first_year, 0);

  v_offer_token       numeric;
  v_token_required    numeric;
  v_an_threshold      numeric;

  v_token_paid        numeric;
  v_app_paid          numeric;
  v_registration_paid numeric;
  v_total_paid        numeric;
  v_paid_toward_course numeric;
  v_seat_block_amount numeric := 0;
  v_seat_block_application_credit numeric := 0;
  v_abvmu_credit      numeric := 0;
  v_abvmu_deposit_amount numeric := 0;
  v_first_token_at    timestamptz;
  v_window_expires    timestamptz;
  v_days_since        numeric;
  v_in_window         boolean;
  v_lump_disc         numeric;
  v_multi_disc        numeric;
  v_full_year_due     numeric;
  v_full_course_due   numeric;
BEGIN
  SELECT token_fee_amount
    INTO v_offer_token
    FROM public.offer_letters
   WHERE lead_id = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  v_token_required := COALESCE(
    (v_policy->>'token_required_amount')::numeric,
    v_offer_token,
    GREATEST(ROUND(v_post_year_1 * v_pan_pct / 100, 2), v_min_instalment)
  );

  v_an_threshold := COALESCE(
    (v_policy->>'an_threshold_amount')::numeric,
    GREATEST(ROUND(v_post_year_1 * v_an_pct / 100, 2), v_min_instalment)
  );

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type IN ('token_fee','pre_admission_token') AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'registration_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee','pre_admission_token','other') AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('token_fee','pre_admission_token','other') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_registration_paid, v_total_paid, v_paid_toward_course
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  SELECT COALESCE(SUM(fsi.amount), 0)
    INTO v_seat_block_amount
    FROM public.fee_structure_items fsi
    JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
   WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
     AND fsi.term = 'year_1'
     AND (fc.code ILIKE '%SEAT%' OR fc.name ILIKE '%SEAT%BLOCK%');

  v_seat_block_application_credit := LEAST(v_app_paid, v_seat_block_amount);
  v_paid_toward_course := v_paid_toward_course + v_seat_block_application_credit;

  v_abvmu_credit := public.lead_abvmu_approved_credit(_lead_id);
  v_abvmu_deposit_amount := public.lead_abvmu_deposit_amount(_lead_id);
  v_paid_toward_course := v_paid_toward_course + v_abvmu_credit;

  SELECT MIN(created_at) INTO v_first_token_at
    FROM public.lead_payments
   WHERE lead_id = _lead_id
     AND type IN ('token_fee','pre_admission_token','other')
     AND status = 'confirmed';

  IF v_first_token_at IS NOT NULL THEN
    v_window_expires := v_first_token_at + (v_window_days || ' days')::interval;
    v_days_since     := EXTRACT(EPOCH FROM (now() - v_first_token_at)) / 86400.0;
    v_in_window      := now() <= v_window_expires;
  ELSE
    v_window_expires := NULL;
    v_days_since     := NULL;
    v_in_window      := true;
  END IF;

  v_lump_disc       := ROUND(v_first_year * v_lump_pct / 100, 2);
  v_full_year_due   := GREATEST(v_first_year - v_paid_toward_course - v_lump_disc, 0);

  v_multi_disc      := ROUND(v_additional * v_lump_pct / 100, 2)
                    + (CASE WHEN v_in_window THEN ROUND(v_additional * v_multi_pct / 100, 2) ELSE 0 END);
  v_full_course_due := GREATEST(v_total_course - v_paid_toward_course - v_lump_disc - v_multi_disc, 0);

  RETURN jsonb_build_object(
    'first_year_fee',               v_first_year,
    'post_scholarship_year_1',      v_post_year_1,
    'total_course_fee',             v_total_course,
    'additional_years_fee',         v_additional,
    'token_required',               v_token_required,
    'token_paid',                   v_token_paid,
    'application_paid',             v_app_paid,
    'registration_paid',            v_registration_paid,
    'total_paid',                   v_total_paid,
    'paid_toward_course',           v_paid_toward_course,
    'seat_block_application_credit', v_seat_block_application_credit,
    'abvmu_deposit_amount',         v_abvmu_deposit_amount,
    'abvmu_approved_credit',        v_abvmu_credit,
    'twenty_five_pct',              v_an_threshold,
    'an_threshold',                 v_an_threshold,
    'pan_threshold_pct',            v_pan_pct,
    'an_threshold_pct',             v_an_pct,
    'min_token_instalment',         v_min_instalment,
    'token_complete',               (v_token_required > 0 AND v_paid_toward_course >= v_token_required),
    'twenty_five_complete',         (v_post_year_1 > 0 AND v_paid_toward_course >= v_an_threshold),
    'token_completed_at',           v_first_token_at,
    'multi_year_window_expires_at', v_window_expires,
    'days_since_token',             v_days_since,
    'within_multi_year_window',     v_in_window,
    'lump_sum_pct',                 v_lump_pct,
    'multi_year_pct',               v_multi_pct,
    'multi_year_window_days',       v_window_days,
    'full_first_year_discount',     v_lump_disc,
    'full_first_year_amount_due',   v_full_year_due,
    'full_course_discount',         (v_lump_disc + v_multi_disc),
    'full_course_amount_due',       v_full_course_due,
    'policy',                       v_policy
  );
END;
$$;


-- 2. recompute_lead_fee_stage — school student INSERT fix ------------------

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
