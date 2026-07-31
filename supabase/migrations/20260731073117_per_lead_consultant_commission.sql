-- Per-lead consultant commission override.
-- Rate priority becomes: per-lead override → per-course card → consultant default.

-- 1. Override columns on the lead (NULL = no override, fall through as before).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS consultant_commission_type  text
    CHECK (consultant_commission_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS consultant_commission_value numeric(12,2);

-- 2. Recompute honours the per-lead override first.
CREATE OR REPLACE FUNCTION public.recompute_consultant_payout(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_consultant_id uuid; v_course_id uuid; v_model text; v_ctype text;
  v_paid numeric; v_value numeric; v_annual numeric;
  v_total numeric; v_payout numeric; v_pct numeric;
  v_ovr_type text; v_ovr_value numeric;
BEGIN
  SELECT consultant_id, course_id, consultant_commission_type, consultant_commission_value
    INTO v_consultant_id, v_course_id, v_ovr_type, v_ovr_value
  FROM public.leads WHERE id = _lead_id;
  IF v_consultant_id IS NULL THEN RETURN; END IF;

  SELECT payout_model::text INTO v_model FROM public.consultants WHERE id = v_consultant_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.lead_payments WHERE lead_id = _lead_id AND status = 'confirmed';

  IF v_model = 'fee_collection' OR v_model IS NULL OR v_paid <= 0 OR v_course_id IS NULL THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  -- Rate: per-lead override first, then per-course card, then consultant default.
  IF v_ovr_value IS NOT NULL THEN
    v_ctype := COALESCE(v_ovr_type, 'percentage');
    v_value := v_ovr_value;
  ELSE
    SELECT commission_type, commission_value INTO v_ctype, v_value
    FROM public.consultant_commissions WHERE consultant_id = v_consultant_id AND course_id = v_course_id;
    IF NOT FOUND THEN
      SELECT commission_type, commission_value INTO v_ctype, v_value FROM public.consultants WHERE id = v_consultant_id;
    END IF;
  END IF;
  v_value := COALESCE(v_value, 0);

  SELECT annual_fee INTO v_annual FROM public.get_consultant_commission(v_consultant_id, v_course_id);
  v_annual := COALESCE(v_annual, 0);

  IF v_ctype = 'percentage' THEN
    v_total := round(v_value / 100.0 * v_annual, 2);
  ELSE
    v_total := v_value;
  END IF;

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
END $function$;

-- 3. Staff RPC to set/clear a per-lead override and recompute the payout.
CREATE OR REPLACE FUNCTION public.set_lead_consultant_commission(
  _lead_id uuid, _commission_type text DEFAULT NULL, _commission_value numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_uid,'super_admin'::app_role)
          OR public.has_role(v_uid,'principal'::app_role)
          OR public.has_role(v_uid,'admission_head'::app_role)
          OR public.has_role(v_uid,'campus_admin'::app_role)) THEN
    RAISE EXCEPTION 'Not allowed to set consultant commission';
  END IF;
  -- Clearing: both NULL. Setting: value required, type defaults to percentage.
  IF _commission_value IS NOT NULL AND _commission_value < 0 THEN
    RAISE EXCEPTION 'Commission value must be zero or positive';
  END IF;
  IF _commission_type IS NOT NULL AND _commission_type NOT IN ('percentage','fixed') THEN
    RAISE EXCEPTION 'Commission type must be percentage or fixed';
  END IF;

  UPDATE public.leads SET
    consultant_commission_value = _commission_value,
    consultant_commission_type  = CASE WHEN _commission_value IS NULL THEN NULL
                                       ELSE COALESCE(_commission_type,'percentage') END
  WHERE id = _lead_id;

  PERFORM public.recompute_consultant_payout(_lead_id);
END $$;
GRANT EXECUTE ON FUNCTION public.set_lead_consultant_commission(uuid, text, numeric) TO authenticated;
