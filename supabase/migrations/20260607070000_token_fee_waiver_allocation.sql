-- ====================================================================
-- Token Fee Engine — Waiver-aware threshold + sequential ledger credit
--
-- Problem 1: lead_post_scholarship_year_1() used offer_letters.scholarship_amount
--   which is always 0 in the new waiver model.  The result was that
--   token_required computed as 10% of the gross Year-1 fee (e.g. ₹13,000)
--   even when the candidate's net Year-1 was only ₹100 after a waiver.
--   Fix: join offer_waivers instead.  Fallback to scholarship_amount for
--   backwards-compatibility with pre-waiver offers.
--
-- Problem 2: lead_fee_status() recomputed token_required from the fee
--   structure, ignoring the admin's explicit token_fee_amount on the
--   offer letter.  Fix: prefer offer_letters.token_fee_amount when set.
-- ====================================================================

-- 1. Update lead_post_scholarship_year_1 to use offer_waivers --------
CREATE OR REPLACE FUNCTION public.lead_post_scholarship_year_1(_lead_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_y1           numeric := public.lead_first_year_fee(_lead_id);
  v_offer_id     uuid;
  v_waivers      numeric := 0;
  v_scholarship  numeric := 0;
BEGIN
  -- Find the latest approved offer for this lead.
  SELECT id, COALESCE(scholarship_amount, 0)
    INTO v_offer_id, v_scholarship
    FROM public.offer_letters
   WHERE lead_id = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_offer_id IS NOT NULL THEN
    -- Sum all approved year_1 waivers on that offer.
    SELECT COALESCE(SUM(amount), 0)
      INTO v_waivers
      FROM public.offer_waivers
     WHERE offer_letter_id = v_offer_id
       AND status          = 'approved'
       AND term            = 'year_1';

    -- If no waivers exist (pre-waiver offer), fall back to scholarship_amount.
    IF v_waivers = 0 THEN
      v_waivers := v_scholarship;
    END IF;
  END IF;

  RETURN GREATEST(0, v_y1 - LEAST(v_waivers, v_y1));
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_post_scholarship_year_1 TO authenticated, service_role;

-- 2. Update lead_fee_status to prefer offer_letters.token_fee_amount --
-- When the admin explicitly set a token on the offer letter, that value
-- IS the token_required — it's what's printed on the letter the candidate
-- received.  Fall back to the policy-computed threshold only when no
-- offer amount is available.
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

  -- Prefer the explicit token_fee_amount from the latest approved offer.
  -- If not set, fall back to policy formula floored at v_min_instalment.
  v_offer_token       numeric;
  v_token_required    numeric;
  v_an_threshold      numeric := GREATEST(ROUND(v_post_year_1 * v_an_pct  / 100, 2), v_min_instalment);

  v_token_paid        numeric;
  v_app_paid          numeric;
  v_total_paid        numeric;
  v_first_token_at    timestamptz;
  v_window_expires    timestamptz;
  v_days_since        numeric;
  v_in_window         boolean;
  v_lump_disc         numeric;
  v_multi_disc        numeric;
  v_full_year_due     numeric;
  v_full_course_due   numeric;
BEGIN
  -- Explicit token from offer letter (what was printed on the document).
  SELECT token_fee_amount
    INTO v_offer_token
    FROM public.offer_letters
   WHERE lead_id    = _lead_id
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;

  v_token_required := COALESCE(
    v_offer_token,
    GREATEST(ROUND(v_post_year_1 * v_pan_pct / 100, 2), v_min_instalment)
  );

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee'       AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_total_paid
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  SELECT MIN(created_at) INTO v_first_token_at
    FROM public.lead_payments
   WHERE lead_id = _lead_id
     AND type    = 'token_fee'
     AND status  = 'confirmed';

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
  v_full_year_due   := GREATEST(v_first_year - v_total_paid - v_lump_disc, 0);

  v_multi_disc      := ROUND(v_additional * v_lump_pct / 100, 2)
                    + (CASE WHEN v_in_window THEN ROUND(v_additional * v_multi_pct / 100, 2) ELSE 0 END);
  v_full_course_due := GREATEST(v_total_course - v_total_paid - v_lump_disc - v_multi_disc, 0);

  RETURN jsonb_build_object(
    'first_year_fee',               v_first_year,
    'post_scholarship_year_1',      v_post_year_1,
    'total_course_fee',             v_total_course,
    'additional_years_fee',         v_additional,
    'token_required',               v_token_required,
    'token_paid',                   v_token_paid,
    'application_paid',             v_app_paid,
    'total_paid',                   v_total_paid,
    'twenty_five_pct',              v_an_threshold,
    'an_threshold',                 v_an_threshold,
    'pan_threshold_pct',            v_pan_pct,
    'an_threshold_pct',             v_an_pct,
    'min_token_instalment',         v_min_instalment,
    'token_complete',               (v_token_required > 0 AND v_token_paid >= v_token_required),
    'twenty_five_complete',         (v_post_year_1 > 0 AND v_total_paid >= v_an_threshold),
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
