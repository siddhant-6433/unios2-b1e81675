-- Enable the 5% lump-sum year-1 discount for B.Sc Nursing and set a
-- lump_sum_deadline of 2026-09-10 on ALL active fee_structures.
-- After that date lead_fee_status returns lump_sum_pct=0 and the discount
-- disappears from the applicant portal automatically.

-- 1a. Enable 5% for B.Sc Nursing (was 0) ------------------------------------
UPDATE public.fee_structures fs
   SET policy = fs.policy
     || '{"lump_sum_first_year_waiver_pct": 5, "multi_year_waiver_pct": 2.5, "lump_sum_deadline": "2026-09-10"}'::jsonb
  FROM public.courses c
 WHERE fs.course_id = c.id
   AND c.name ILIKE '%B.Sc%Nurs%'
   AND fs.is_active = true;

-- 1b. Stamp deadline on ALL active fee_structures ---------------------------
UPDATE public.fee_structures
   SET policy = COALESCE(policy, '{}'::jsonb)
     || '{"lump_sum_deadline": "2026-09-10"}'::jsonb
 WHERE is_active = true;

-- 2. lead_fee_status — add lump_sum_deadline gate ----------------------------

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
  v_lump_deadline     date    := (v_policy->>'lump_sum_deadline')::date; -- ponytail: generic deadline gate

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
  -- Zero lump-sum discount if the deadline has passed
  IF v_lump_deadline IS NOT NULL AND now()::date > v_lump_deadline THEN
    v_lump_pct := 0;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.lead_fee_status TO authenticated, service_role;
