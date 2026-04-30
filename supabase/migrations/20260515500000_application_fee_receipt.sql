ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS fee_receipt_url text;
