-- Add Zoho Books reference columns for video billing (mirrors consultant_payout_zoho_refs)

ALTER TABLE public.video_editors
  ADD COLUMN IF NOT EXISTS zoho_vendor_id text;

ALTER TABLE public.video_bills
  ADD COLUMN IF NOT EXISTS zoho_bill_id     text,
  ADD COLUMN IF NOT EXISTS zoho_bill_number text,
  ADD COLUMN IF NOT EXISTS zoho_payment_id  text,
  ADD COLUMN IF NOT EXISTS zoho_synced_at   timestamptz,
  ADD COLUMN IF NOT EXISTS zoho_sync_error  text;
