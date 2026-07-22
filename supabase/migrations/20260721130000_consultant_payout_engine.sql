-- #4 Consultant payout models + auto-compute engine + fee-collection remittance.
--
-- Until now consultant_payouts was a dormant, hand-managed table — so consultant
-- commission showed against whatever rows happened to exist (a credit-note test
-- row) and NOT against gateway/cash receipts. This activates it: every confirmed
-- fee payment on a consultant's lead recomputes the payout from the consultant's
-- payout model.

-- 1. Payout model per consultant ---------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consultant_payout_model') THEN
    CREATE TYPE public.consultant_payout_model AS ENUM (
      'commission_pct_first_year',  -- college pays % of first-year fee, released as the student pays
      'commission_fixed',           -- college pays a fixed amount per admission
      'fee_collection'              -- consultant collects fee directly; college waives + pays nothing
    );
  END IF;
END $$;

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS payout_model public.consultant_payout_model NOT NULL DEFAULT 'commission_pct_first_year';

-- 2. One payout row per (consultant, lead) so the engine can upsert -----------
ALTER TABLE public.consultant_payouts DROP CONSTRAINT IF EXISTS consultant_payouts_consultant_lead_key;
ALTER TABLE public.consultant_payouts ADD CONSTRAINT consultant_payouts_consultant_lead_key UNIQUE (consultant_id, lead_id);

-- Replace the legacy per-payment fn_auto_create_payout trigger (it inserted one
-- payout row per payment → duplicates, and collides with the unique constraint
-- below). The recompute below is per-lead, idempotent, and model-aware.
DROP TRIGGER IF EXISTS trg_auto_create_payout ON public.lead_payments;

-- 3. Recompute one lead's payout from its confirmed fee payments --------------
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

  -- Fee actually received on this lead (all confirmed modes: gateway/cash/upi/credit-note).
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.lead_payments WHERE lead_id = _lead_id AND status = 'confirmed';

  -- Fee-collection consultants earn no commission; drop any stale payout row.
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

  -- Released proportionally to first-year fee paid.
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
    -- never reduce a payout already marked paid
    payout_amount = CASE WHEN consultant_payouts.status = 'paid'
                         THEN consultant_payouts.payout_amount ELSE EXCLUDED.payout_amount END;
END $$;

-- 4. Trigger: recompute on any confirmed-payment change ----------------------
CREATE OR REPLACE FUNCTION public.trg_recompute_consultant_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_consultant_payout(OLD.lead_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_consultant_payout(NEW.lead_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lead_payments_consultant_payout ON public.lead_payments;
CREATE TRIGGER lead_payments_consultant_payout
AFTER INSERT OR UPDATE OR DELETE ON public.lead_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_consultant_payout();

-- 5. Fee-collection remittance ledger (what the college actually receives) ----
CREATE TABLE IF NOT EXISTS public.consultant_fee_collection_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  amount_collected numeric(12,2),                 -- collected from the student by the consultant
  amount_remitted numeric(12,2) NOT NULL CHECK (amount_remitted >= 0),  -- paid to the college
  remittance_ref text,
  note text,
  recorded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cfc_remittances_consultant ON public.consultant_fee_collection_remittances(consultant_id);

ALTER TABLE public.consultant_fee_collection_remittances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin manage consultant remittances"
  ON public.consultant_fee_collection_remittances FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Consultants read own remittances"
  ON public.consultant_fee_collection_remittances FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid()));
GRANT SELECT ON public.consultant_fee_collection_remittances TO authenticated;

CREATE OR REPLACE FUNCTION public.record_consultant_fee_remittance(
  _consultant_id uuid,
  _amount_remitted numeric,
  _lead_id uuid DEFAULT NULL,
  _student_id uuid DEFAULT NULL,
  _amount_collected numeric DEFAULT NULL,
  _remittance_ref text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_profile uuid; v_id uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can record consultant fee remittances';
  END IF;
  IF _amount_remitted IS NULL OR _amount_remitted < 0 THEN
    RAISE EXCEPTION 'Remittance amount must be zero or positive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants WHERE id = _consultant_id) THEN
    RAISE EXCEPTION 'Consultant not found';
  END IF;
  SELECT id INTO v_profile FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  INSERT INTO public.consultant_fee_collection_remittances
    (consultant_id, lead_id, student_id, amount_collected, amount_remitted, remittance_ref, note, recorded_by)
  VALUES (_consultant_id, _lead_id, _student_id, _amount_collected, _amount_remitted, _remittance_ref, _note, v_profile)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.record_consultant_fee_remittance(uuid, numeric, uuid, uuid, numeric, text, text) TO authenticated;
