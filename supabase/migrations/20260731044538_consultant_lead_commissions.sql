-- Per-lead commission overrides for consultants.
-- Hierarchy: lead-specific → course-specific → consultant default.

CREATE TABLE IF NOT EXISTS public.consultant_lead_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  commission_type text NOT NULL CHECK (commission_type IN ('percentage', 'fixed', 'fixed_annual')),
  commission_value numeric(12,2) NOT NULL CHECK (commission_value >= 0),
  notes text,
  set_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_clc_consultant ON public.consultant_lead_commissions(consultant_id);
CREATE INDEX IF NOT EXISTS idx_clc_lead ON public.consultant_lead_commissions(lead_id);

ALTER TABLE public.consultant_lead_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage lead commissions"
  ON public.consultant_lead_commissions FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::app_role) OR
    public.has_role(auth.uid(), 'principal'::app_role) OR
    public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::app_role) OR
    public.has_role(auth.uid(), 'principal'::app_role) OR
    public.has_role(auth.uid(), 'admission_head'::app_role)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_lead_commissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_lead_commissions TO service_role;

-- Update the payout engine: lead-specific → course-specific → consultant default
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

  IF v_model = 'fee_collection' OR v_model IS NULL OR v_paid <= 0 OR v_course_id IS NULL THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  -- Rate: per-lead first, then per-course, then consultant default.
  SELECT commission_type, commission_value INTO v_ctype, v_value
  FROM public.consultant_lead_commissions WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
  IF NOT FOUND THEN
    SELECT commission_type, commission_value INTO v_ctype, v_value
    FROM public.consultant_commissions WHERE consultant_id = v_consultant_id AND course_id = v_course_id;
  END IF;
  IF NOT FOUND THEN
    SELECT commission_type, commission_value INTO v_ctype, v_value FROM public.consultants WHERE id = v_consultant_id;
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
END $$;

-- Recompute when a lead override is set/changed
CREATE OR REPLACE FUNCTION public.trg_recompute_on_lead_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_consultant_payout(OLD.lead_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_consultant_payout(NEW.lead_id);
  RETURN NEW;
END $$;

CREATE TRIGGER lead_commission_recompute_payout
AFTER INSERT OR UPDATE OR DELETE ON public.consultant_lead_commissions
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_on_lead_commission();
