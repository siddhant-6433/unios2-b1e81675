-- keep-migration-version: restored production migration 20261013070245; preserve its applied version.
-- schoolknot archive receipt modes

-- Preserve Schoolknot's non-cash voucher, card, and challan receipt modes.
-- Existing Uni collection modes are unchanged. Extra modes are accepted only
-- on explicitly identified historical Schoolknot archive records.
ALTER TABLE public.lead_payments
  DROP CONSTRAINT lead_payments_payment_mode_check;

ALTER TABLE public.lead_payments
  -- lint-allow: historical production migration already applied; preserve exact migration history.
  ADD CONSTRAINT lead_payments_payment_mode_check CHECK (
    payment_mode = ANY (ARRAY[
      'cash', 'upi', 'bank_transfer', 'cheque', 'online', 'gateway',
      'consultant_credit_note'
    ]::text[])
    OR (
      gateway IS NOT DISTINCT FROM 'schoolknot_archive'
      AND payment_mode = ANY (ARRAY['voucher', 'card', 'challan']::text[])
    )
  );
