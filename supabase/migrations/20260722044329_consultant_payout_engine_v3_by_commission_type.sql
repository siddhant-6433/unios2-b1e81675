-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260722044329 name=consultant_payout_engine_v3_by_commission_type applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.recompute_consultant_payout(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_consultant_id uuid; v_course_id uuid; v_model text; v_ctype text;
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

  -- Rate: per-course card first, else the consultant default. commission_type is
  -- the source of truth for fixed-vs-percentage so an out-of-sync payout_model
  -- can never turn a fixed rupee amount into a percentage.
  SELECT commission_type, commission_value INTO v_ctype, v_value
  FROM public.consultant_commissions WHERE consultant_id = v_consultant_id AND course_id = v_course_id;
  IF NOT FOUND THEN
    SELECT commission_type, commission_value INTO v_ctype, v_value FROM public.consultants WHERE id = v_consultant_id;
  END IF;
  v_value := COALESCE(v_value, 0);

  SELECT annual_fee INTO v_annual FROM public.get_consultant_commission(v_consultant_id, v_course_id);
  v_annual := COALESCE(v_annual, 0);

  -- Total commission for the full first-year fee.
  IF v_ctype = 'percentage' THEN
    v_total := round(v_value / 100.0 * v_annual, 2);   -- value is a percentage
  ELSE
    v_total := v_value;                                -- fixed / fixed_annual / flat: rupee amount
  END IF;

  -- Released proportionally to first-year fee paid (matches prior behaviour).
  IF v_annual > 0 THEN
    v_payout := round(LEAST(v_paid, v_annual) / v_annual * v_total, 2);
    v_pct := LEAST(100, round(v_paid / v_annual * 100, 2));
  ELSE
    v_payout := CASE WHEN v_ctype = 'percentage' THEN 0 ELSE v_total END;
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
    v_consultant_id, _lead_id, v_course_id, COALESCE(v_ctype, v_model), v_value,
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
