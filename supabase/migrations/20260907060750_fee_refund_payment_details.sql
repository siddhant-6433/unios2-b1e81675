-- Manual payment details on fee refunds, and super_admin-only approval.
-- Accountants record how the bank transfer actually happened (mode, UTR,
-- date, proof) so UniOs matches the real payout — including refunds that
-- were already paid outside the app.

ALTER TABLE public.fee_refunds
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.fee_refunds.payment_reference IS
  'Bank UTR / cheque no. / UPI ref entered when the accountant marks the refund paid.';
COMMENT ON COLUMN public.fee_refunds.payment_proof_url IS
  'Screenshot or slip of the payout, stored in application-documents.';

-- Approve: super_admin only ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_fee_refund(_refund_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can approve a refund';
  END IF;
  SELECT status INTO v_status FROM public.fee_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Only a draft refund can be approved (is %)', v_status; END IF;
  UPDATE public.fee_refunds
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = _refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_fee_refund(uuid) TO authenticated, service_role;

-- Mark paid / attach transaction details --------------------------------------
-- Accountant or finance:refund. If the refund is already paid (Zoho poll,
-- earlier mark-paid), this only updates the payment fields — the ledger
-- trigger is status-change guarded and will not reverse twice.
-- Drop the original 1-arg form so PostgREST has a single overload; defaults
-- keep existing `{ _refund_id }` callers (Zoho poll / webhook) working.
DROP FUNCTION IF EXISTS public.mark_fee_refund_paid(uuid);

CREATE OR REPLACE FUNCTION public.mark_fee_refund_paid(
  _refund_id uuid,
  _payment_mode text DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _payment_date date DEFAULT NULL,
  _proof_url text DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.can_manage_fee_refund(v_actor) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT status INTO v_status FROM public.fee_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_status = 'rejected' THEN
    RAISE EXCEPTION 'A rejected refund cannot be marked paid';
  END IF;
  IF v_status <> 'paid' AND v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved refund can be paid (is %)', v_status;
  END IF;

  UPDATE public.fee_refunds SET
    status             = 'paid',
    paid_at            = COALESCE(paid_at, now()),
    paid_by            = COALESCE(paid_by, v_actor),
    payment_mode       = COALESCE(NULLIF(btrim(_payment_mode), ''), payment_mode),
    payment_reference  = COALESCE(NULLIF(btrim(_payment_reference), ''), payment_reference),
    payment_date       = COALESCE(_payment_date, payment_date, CURRENT_DATE),
    payment_proof_url  = COALESCE(NULLIF(btrim(_proof_url), ''), payment_proof_url),
    notes              = CASE
                           WHEN NULLIF(btrim(_note), '') IS NULL THEN notes
                           WHEN notes IS NULL OR notes = '' THEN btrim(_note)
                           ELSE notes || E'\n' || btrim(_note)
                         END
   WHERE id = _refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.mark_fee_refund_paid(uuid, text, text, date, text, text) TO authenticated, service_role;
