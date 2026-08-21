-- Bank/UPI reference (RRN) on lead_payments.
--
-- Why: the same rupee can reach us twice — once through the gateway (settled
-- late by the reconcile sweep) and once hand-keyed by a cashier from the
-- candidate's screenshot. The only identifier both paths share is the bank
-- reference the payer sees on their own statement (EaseBuzz `bank_ref_num`,
-- e.g. 623218563454). Storing it gives the duplicate guard something to match
-- on; the partial unique index makes the double-receipt impossible rather than
-- merely unlikely.

ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS bank_ref_num text;

COMMENT ON COLUMN public.lead_payments.bank_ref_num IS
  'Bank/UPI RRN as reported by the gateway (or typed by the operator for offline entries). Used to dedupe a gateway settlement against a manual entry of the same payment.';

CREATE UNIQUE INDEX IF NOT EXISTS lead_payments_confirmed_bank_ref_uidx
  ON public.lead_payments (bank_ref_num)
  WHERE status = 'confirmed' AND bank_ref_num IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_payments_pending_gateway
  ON public.lead_payments (lead_id, created_at DESC)
  WHERE status = 'pending' AND payment_mode = 'gateway';
