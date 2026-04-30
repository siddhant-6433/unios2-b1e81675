-- ====================================================================
-- Fee policy generalization
--   Move PAN / AN thresholds, min instalment, and waiver settings out
--   of hardcoded SQL constants and into per-fee_structure JSONB so
--   different courses, sessions, and institutions (NIMT / School /
--   Mirai) can carry their own rules without forking the engine.
--
--   Default policy (used when a structure leaves a key empty):
--     pan_threshold_pct           = 10   (token = 10% of first-year)
--     an_threshold_pct            = 25   (admission at 25% of first-year)
--     min_token_instalment        = 5000 (₹ minimum per token instalment)
--     lump_sum_first_year_waiver_pct = 0  (set per institution later)
--     multi_year_waiver_pct       = 3    (waiver if remaining years paid)
--     multi_year_window_days      = 7    (days after token payment)
--
--   The waiver fields are stored now and will be consumed in Phase C
--   (receipt + payment-time discount). For Phase B we only generalise
--   the threshold-based stage advancement.
-- ====================================================================

-- 1. policy column on fee_structures
ALTER TABLE public.fee_structures
  ADD COLUMN IF NOT EXISTS policy JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.fee_structures.policy IS
  'JSON config: pan_threshold_pct, an_threshold_pct, min_token_instalment, lump_sum_first_year_waiver_pct, multi_year_waiver_pct, multi_year_window_days. Empty keys fall back to defaults in lead_fee_policy().';

-- 2. Default policy + per-lead resolution
CREATE OR REPLACE FUNCTION public.lead_fee_policy(_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH defaults AS (
    SELECT jsonb_build_object(
      'pan_threshold_pct',              10,
      'an_threshold_pct',               25,
      'min_token_instalment',           5000,
      'lump_sum_first_year_waiver_pct', 0,
      'multi_year_waiver_pct',          3,
      'multi_year_window_days',         7
    ) AS d
  ),
  structure_policy AS (
    SELECT COALESCE(fs.policy, '{}'::jsonb) AS p
      FROM public.leads l
      LEFT JOIN public.fee_structures fs
        ON fs.course_id = l.course_id
       AND fs.session_id = l.session_id
       AND fs.is_active = true
     WHERE l.id = _lead_id
     LIMIT 1
  )
  SELECT defaults.d || COALESCE((SELECT p FROM structure_policy), '{}'::jsonb)
    FROM defaults;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_policy TO authenticated, service_role;

-- 3. Rewrite lead_fee_status to use policy-driven thresholds
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
  v_first_year      numeric := public.lead_first_year_fee(_lead_id);
  v_token_required  numeric := ROUND(v_first_year * v_pan_pct / 100, 2);
  v_an_threshold    numeric := ROUND(v_first_year * v_an_pct / 100, 2);
  v_token_paid      numeric;
  v_app_paid        numeric;
  v_total_paid      numeric;
BEGIN
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'token_fee'       AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
    COALESCE(SUM(amount) FILTER (WHERE type IN ('application_fee','token_fee','registration_fee') AND status = 'confirmed'), 0)
  INTO v_token_paid, v_app_paid, v_total_paid
  FROM public.lead_payments
  WHERE lead_id = _lead_id;

  RETURN jsonb_build_object(
    'first_year_fee',       v_first_year,
    'token_required',       v_token_required,
    'token_paid',           v_token_paid,
    'application_paid',     v_app_paid,
    'total_paid',           v_total_paid,
    'twenty_five_pct',      v_an_threshold,   -- legacy field name; value reflects an_threshold_pct
    'an_threshold',         v_an_threshold,
    'pan_threshold_pct',    v_pan_pct,
    'an_threshold_pct',     v_an_pct,
    'min_token_instalment', v_min_instalment,
    'token_complete',       (v_first_year > 0 AND v_token_paid >= v_token_required),
    'twenty_five_complete', (v_first_year > 0 AND v_total_paid >= v_an_threshold),
    'policy',               v_policy
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_status TO authenticated, service_role;

-- 4. Backfill leads.token_amount when the policy moves the threshold
--    (no-op today since defaults match what was hard-coded; included so
--     a later change to a structure's pan_threshold_pct is honoured for
--     any lead still on stage='offer_sent' without a payment yet)
UPDATE public.leads l
   SET token_amount = ROUND(
     public.lead_first_year_fee(l.id)
     * COALESCE((public.lead_fee_policy(l.id)->>'pan_threshold_pct')::numeric, 10)
     / 100, 2)
 WHERE l.session_id IS NOT NULL
   AND l.course_id IS NOT NULL
   AND l.stage IN ('offer_sent','token_paid')
   AND public.lead_first_year_fee(l.id) > 0;

-- 5. Handy admin RPC: set the policy on a fee_structure (super-admin only)
CREATE OR REPLACE FUNCTION public.set_fee_structure_policy(_fee_structure_id uuid, _policy jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_updated jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change fee policy';
  END IF;

  -- Validate known keys (extra keys are dropped to keep policy clean)
  v_updated := jsonb_strip_nulls(jsonb_build_object(
    'pan_threshold_pct',              _policy->'pan_threshold_pct',
    'an_threshold_pct',               _policy->'an_threshold_pct',
    'min_token_instalment',           _policy->'min_token_instalment',
    'lump_sum_first_year_waiver_pct', _policy->'lump_sum_first_year_waiver_pct',
    'multi_year_waiver_pct',          _policy->'multi_year_waiver_pct',
    'multi_year_window_days',         _policy->'multi_year_window_days'
  ));

  UPDATE public.fee_structures
     SET policy = v_updated
   WHERE id = _fee_structure_id;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_fee_structure_policy TO authenticated, service_role;
