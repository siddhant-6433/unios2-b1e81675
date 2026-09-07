-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260722043941 name=consultant_payout_engine_proportional applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Replace the per-payment fn_auto_create_payout trigger (dropped separately) with
-- a per-lead, proportional recompute that matches the existing payout math but
-- upserts one row per lead (no duplicates) and honours payout_model.
DROP TRIGGER IF EXISTS trg_auto_create_payout ON public.lead_payments;

CREATE OR REPLACE FUNCTION public.recompute_consultant_payout(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_consultant_id uuid; v_course_id uuid; v_model text;
  v_paid numeric; v_value numeric; v_annual numeric;
  v_total numeric; v_payout numeric; v_pct numeric;
BEGIN
  SELECT consultant_id, course_id INTO v_consultant_id, v_course_id
  FROM public.leads WHERE id = _lead_id;
  IF v_consultant_id IS NULL THEN RETURN; END IF;

  SELECT payout_model::text INTO v_model FROM public.consultants WHERE id = v_consultant_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.lead_payments WHERE lead_id = _lead_id AND status = 'confirmed';

  -- Fee-collection consultants earn no commission.
  IF v_model = 'fee_collection' OR v_model IS NULL OR v_paid <= 0 OR v_course_id IS NULL THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  -- Rate value + first-year fee (reuses the existing resolver).
  SELECT commission_amount, annual_fee INTO v_value, v_annual
  FROM public.get_consultant_commission(v_consultant_id, v_course_id);
  v_value := COALESCE(v_value, 0);
  v_annual := COALESCE(v_annual, 0);

  -- Total commission for the full first-year fee, per the consultant's model:
  --   commission_pct_first_year: value is a percentage of the first-year fee
  --   commission_fixed:          value is a fixed rupee amount
  IF v_model = 'commission_pct_first_year' THEN
    v_total := round(v_value / 100.0 * v_annual, 2);
  ELSE
    v_total := v_value;
  END IF;

  -- Released proportionally to how much of the first-year fee has been paid.
  IF v_annual > 0 THEN
    v_payout := round(LEAST(v_paid, v_annual) / v_annual * v_total, 2);
    v_pct := LEAST(100, round(v_paid / v_annual * 100, 2));
  ELSE
    -- No first-year fee on file: a fixed amount still pays in full; a % cannot be computed.
    v_payout := CASE WHEN v_model = 'commission_fixed' THEN v_total ELSE 0 END;
    v_pct := 0;
  END IF;

  IF v_payout <= 0 THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  INSERT INTO public.consultant_payouts (
    consultant_id, lead_id, course_id, commission_type, commission_value,
    student_fee_paid, annual_fee, fee_paid_pct, payout_amount, status
  ) VALUES (
    v_consultant_id, _lead_id, v_course_id, v_model, v_value,
    v_paid, v_annual, v_pct, v_payout, 'pending'
  )
  ON CONFLICT (consultant_id, lead_id) DO UPDATE SET
    course_id = EXCLUDED.course_id,
    commission_type = EXCLUDED.commission_type,
    commission_value = EXCLUDED.commission_value,
    student_fee_paid = EXCLUDED.student_fee_paid,
    annual_fee = EXCLUDED.annual_fee,
    fee_paid_pct = EXCLUDED.fee_paid_pct,
    payout_amount = CASE WHEN consultant_payouts.status = 'paid'
                         THEN consultant_payouts.payout_amount ELSE EXCLUDED.payout_amount END;
END $$;
