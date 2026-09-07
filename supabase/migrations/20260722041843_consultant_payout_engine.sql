-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260722041843 name=consultant_payout_engine applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consultant_payout_model') THEN
    CREATE TYPE public.consultant_payout_model AS ENUM (
      'commission_pct_first_year', 'commission_fixed', 'fee_collection'
    );
  END IF;
END $$;

ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS payout_model public.consultant_payout_model NOT NULL DEFAULT 'commission_pct_first_year';

ALTER TABLE public.consultant_payouts DROP CONSTRAINT IF EXISTS consultant_payouts_consultant_lead_key;
ALTER TABLE public.consultant_payouts ADD CONSTRAINT consultant_payouts_consultant_lead_key UNIQUE (consultant_id, lead_id);

CREATE OR REPLACE FUNCTION public.recompute_consultant_payout(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_consultant_id uuid; v_course_id uuid; v_model text;
  v_paid numeric; v_first_year numeric; v_ctype text; v_cval numeric;
  v_basis numeric; v_payout numeric; v_pct numeric;
BEGIN
  SELECT consultant_id, course_id INTO v_consultant_id, v_course_id
  FROM public.leads WHERE id = _lead_id;
  IF v_consultant_id IS NULL THEN RETURN; END IF;

  SELECT payout_model::text INTO v_model FROM public.consultants WHERE id = v_consultant_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.lead_payments WHERE lead_id = _lead_id AND status = 'confirmed';

  IF v_model = 'fee_collection' OR v_model IS NULL OR v_paid <= 0 THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  SELECT commission_type, commission_value INTO v_ctype, v_cval
  FROM public.consultant_commissions WHERE consultant_id = v_consultant_id AND course_id = v_course_id;
  IF NOT FOUND THEN
    SELECT commission_type, commission_value INTO v_ctype, v_cval FROM public.consultants WHERE id = v_consultant_id;
  END IF;
  v_cval := COALESCE(v_cval, 0);

  v_first_year := COALESCE(NULLIF(public.lead_first_year_net_fee(_lead_id), 0), public.lead_first_year_fee(_lead_id), 0);
  v_pct := CASE WHEN v_first_year > 0 THEN LEAST(100, round(v_paid / v_first_year * 100, 2)) ELSE 0 END;

  IF v_model = 'commission_fixed' THEN
    v_payout := v_cval;
  ELSE
    v_basis := CASE WHEN v_first_year > 0 THEN LEAST(v_paid, v_first_year) ELSE v_paid END;
    v_payout := round(v_cval / 100.0 * v_basis, 2);
  END IF;

  INSERT INTO public.consultant_payouts (
    consultant_id, lead_id, course_id, commission_type, commission_value,
    student_fee_paid, annual_fee, fee_paid_pct, payout_amount, status
  ) VALUES (
    v_consultant_id, _lead_id, v_course_id, COALESCE(v_ctype, v_model), v_cval,
    v_paid, v_first_year, v_pct, v_payout, 'pending'
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

CREATE TABLE IF NOT EXISTS public.consultant_fee_collection_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  amount_collected numeric(12,2),
  amount_remitted numeric(12,2) NOT NULL CHECK (amount_remitted >= 0),
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
  _consultant_id uuid, _amount_remitted numeric, _lead_id uuid DEFAULT NULL,
  _student_id uuid DEFAULT NULL, _amount_collected numeric DEFAULT NULL,
  _remittance_ref text DEFAULT NULL, _note text DEFAULT NULL
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
