-- ====================================================================
-- Waiver consumption (phase D)
--   Lets the candidate pay full first-year or full course fee with the
--   policy-driven discount applied. Stores the discount on the
--   lead_payments row so accountant + ledger logic can reconcile later.
--
--   1. lead_payments gains concession_amount + waiver_reason
--   2. lead_fee_status now also returns:
--        total_course_fee, additional_years_fee,
--        token_completed_at, days_since_token,
--        within_multi_year_window, full_first_year_due,
--        full_course_due, plus the discount quotes for both scenarios
-- ====================================================================

-- 1. Track the waiver applied on each payment.
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS concession_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waiver_reason     text;

COMMENT ON COLUMN public.lead_payments.concession_amount IS
  'Discount applied on top of amount paid (e.g. 5% lump-sum or 7.5% multi-year). The student paid `amount`; the institution credits `amount + concession_amount` against the fee.';
COMMENT ON COLUMN public.lead_payments.waiver_reason IS
  'Free-text label for the discount (e.g. "Lump-sum first-year 5%", "Multi-year within 5 days 7.5%").';

-- 2. Helper: total course fee = sum of fee_structure_items across all year_N terms.
CREATE OR REPLACE FUNCTION public.lead_total_course_fee(_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(fsi.amount), 0)::numeric
  FROM public.leads l
  JOIN public.fee_structures fs
    ON fs.course_id = l.course_id
   AND fs.session_id = l.session_id
   AND fs.is_active = true
  JOIN public.fee_structure_items fsi
    ON fsi.fee_structure_id = fs.id
   AND fsi.term LIKE 'year\_%' ESCAPE '\'
  WHERE l.id = _lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_total_course_fee TO authenticated, service_role;

-- 3. Replace lead_fee_status with the richer waiver-aware version.
CREATE OR REPLACE FUNCTION public.lead_fee_status(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy          jsonb   := public.lead_fee_policy(_lead_id);
  v_pan_pct         numeric := COALESCE((v_policy->>'pan_threshold_pct')::numeric, 10);
  v_an_pct          numeric := COALESCE((v_policy->>'an_threshold_pct')::numeric, 25);
  v_min_instalment  numeric := COALESCE((v_policy->>'min_token_instalment')::numeric, 5000);
  v_lump_pct        numeric := COALESCE((v_policy->>'lump_sum_first_year_waiver_pct')::numeric, 0);
  v_multi_pct       numeric := COALESCE((v_policy->>'multi_year_waiver_pct')::numeric, 0);
  v_window_days     int     := COALESCE((v_policy->>'multi_year_window_days')::numeric, 0);

  v_first_year      numeric := public.lead_first_year_fee(_lead_id);
  v_total_course    numeric := public.lead_total_course_fee(_lead_id);
  v_additional      numeric := GREATEST(v_total_course - v_first_year, 0);
  v_token_required  numeric := ROUND(v_first_year * v_pan_pct / 100, 2);
  v_an_threshold    numeric := ROUND(v_first_year * v_an_pct / 100, 2);
  v_token_paid      numeric;
  v_app_paid        numeric;
  v_total_paid      numeric;
  v_token_done_at   timestamptz;
  v_days_since      numeric;
  v_in_window       boolean;
  v_lump_disc       numeric;
  v_multi_disc      numeric;
  v_full_year_due   numeric;
  v_full_course_due numeric;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee'       AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_total_paid
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  -- Earliest stage transition into 'token_paid' tells us when the 10%
  -- threshold was first crossed. Fallback: now (so window is open).
  SELECT MIN(created_at) INTO v_token_done_at
    FROM public.lead_activities
   WHERE lead_id = _lead_id
     AND new_stage = 'token_paid';

  IF v_token_done_at IS NOT NULL THEN
    v_days_since := EXTRACT(EPOCH FROM (now() - v_token_done_at)) / 86400.0;
    v_in_window  := v_days_since <= v_window_days;
  ELSE
    v_days_since := NULL;
    v_in_window  := true;  -- token not yet complete → still time
  END IF;

  -- Full first-year lump-sum: pay the remaining first-year balance,
  -- save lump_pct% of the first-year fee.
  v_lump_disc      := ROUND(v_first_year * v_lump_pct / 100, 2);
  v_full_year_due  := GREATEST(v_first_year - v_total_paid - v_lump_disc, 0);

  -- Full course: lump on year_1 + (lump + multi if within window, else
  -- only lump) on additional years.
  v_multi_disc     := ROUND(v_additional * v_lump_pct / 100, 2)
                    + (CASE WHEN v_in_window THEN ROUND(v_additional * v_multi_pct / 100, 2) ELSE 0 END);
  v_full_course_due := GREATEST(v_total_course - v_total_paid - v_lump_disc - v_multi_disc, 0);

  RETURN jsonb_build_object(
    'first_year_fee',       v_first_year,
    'total_course_fee',     v_total_course,
    'additional_years_fee', v_additional,
    'token_required',       v_token_required,
    'token_paid',           v_token_paid,
    'application_paid',     v_app_paid,
    'total_paid',           v_total_paid,
    'twenty_five_pct',      v_an_threshold,
    'an_threshold',         v_an_threshold,
    'pan_threshold_pct',    v_pan_pct,
    'an_threshold_pct',     v_an_pct,
    'min_token_instalment', v_min_instalment,
    'token_complete',       (v_first_year > 0 AND v_token_paid >= v_token_required),
    'twenty_five_complete', (v_first_year > 0 AND v_total_paid >= v_an_threshold),
    'token_completed_at',   v_token_done_at,
    'days_since_token',     v_days_since,
    'within_multi_year_window', v_in_window,
    'lump_sum_pct',         v_lump_pct,
    'multi_year_pct',       v_multi_pct,
    'multi_year_window_days', v_window_days,
    'full_first_year_discount', v_lump_disc,
    'full_first_year_amount_due', v_full_year_due,
    'full_course_discount',  (v_lump_disc + v_multi_disc),
    'full_course_amount_due', v_full_course_due,
    'policy',               v_policy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_status TO authenticated, service_role;
