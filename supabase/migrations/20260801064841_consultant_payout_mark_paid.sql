-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260801064841 name=consultant_payout_mark_paid applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.consultant_payouts
  ADD COLUMN IF NOT EXISTS payment_reference  text,
  ADD COLUMN IF NOT EXISTS payment_mode       text,
  ADD COLUMN IF NOT EXISTS payment_date       date,
  ADD COLUMN IF NOT EXISTS payment_proof_path text,
  ADD COLUMN IF NOT EXISTS paid_by            uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.mark_consultant_payout_paid(
  _payout_id uuid,
  _payment_mode text DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _payment_date date DEFAULT NULL,
  _proof_path text DEFAULT NULL,
  _note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_profile uuid;
BEGIN
  IF NOT (public.has_role(v_uid, 'super_admin'::app_role)
          OR public.has_role(v_uid, 'campus_admin'::app_role)
          OR public.has_role(v_uid, 'admission_head'::app_role)) THEN
    RAISE EXCEPTION 'Not allowed to mark consultant payouts paid';
  END IF;
  SELECT id INTO v_profile FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  UPDATE public.consultant_payouts SET
    status             = 'paid',
    paid_at            = now(),
    paid_by            = v_profile,
    payment_mode       = _payment_mode,
    payment_reference  = _payment_reference,
    payment_date       = COALESCE(_payment_date, CURRENT_DATE),
    payment_proof_path = COALESCE(_proof_path, payment_proof_path),
    notes              = COALESCE(_note, notes)
  WHERE id = _payout_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout not found'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_consultant_payout_paid(uuid, text, text, date, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unmark_consultant_payout_paid(_payout_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_lead uuid;
BEGIN
  IF NOT (public.has_role(v_uid, 'super_admin'::app_role)
          OR public.has_role(v_uid, 'campus_admin'::app_role)
          OR public.has_role(v_uid, 'admission_head'::app_role)) THEN
    RAISE EXCEPTION 'Not allowed to change consultant payouts';
  END IF;
  UPDATE public.consultant_payouts SET
    status = 'pending', paid_at = NULL, paid_by = NULL,
    payment_mode = NULL, payment_reference = NULL, payment_date = NULL, payment_proof_path = NULL
  WHERE id = _payout_id
  RETURNING lead_id INTO v_lead;
  IF v_lead IS NOT NULL THEN PERFORM public.recompute_consultant_payout(v_lead); END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.unmark_consultant_payout_paid(uuid) TO authenticated;

DROP VIEW IF EXISTS public.consultant_payout_sheet;
CREATE VIEW public.consultant_payout_sheet AS
SELECT
  cp.id            AS payout_id,
  cp.consultant_id,
  c.name           AS consultant_name,
  c.bank_account_name,
  c.bank_account_number,
  c.bank_ifsc,
  c.bank_name,
  c.bank_upi,
  cp.lead_id,
  l.name           AS candidate_name,
  COALESCE(l.admission_no, l.pre_admission_no) AS admission_no,
  crs.name         AS course_name,
  cp.student_fee_paid,
  cp.annual_fee,
  cp.payout_amount,
  cp.fee_paid_pct,
  cp.status,
  cp.payment_mode,
  cp.payment_reference,
  cp.payment_date,
  cp.payment_proof_path,
  cp.paid_at,
  cp.created_at
FROM public.consultant_payouts cp
JOIN public.consultants c ON c.id = cp.consultant_id
JOIN public.leads       l ON l.id = cp.lead_id
LEFT JOIN public.courses crs ON crs.id = cp.course_id;

GRANT SELECT ON public.consultant_payout_sheet TO authenticated;
