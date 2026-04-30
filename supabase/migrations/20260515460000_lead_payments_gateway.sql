-- Track which payment-gateway handled each gateway-mode payment so receipts /
-- application forms can show "Easebuzz Gateway" vs "ICICI Gateway" instead of
-- a generic "Gateway" label.
ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS gateway text;

COMMENT ON COLUMN public.lead_payments.gateway IS
  'Lowercase slug of the payment gateway used: easebuzz, icici, cashfree, etc. NULL for cash/UPI/bank_transfer/cheque payments.';
