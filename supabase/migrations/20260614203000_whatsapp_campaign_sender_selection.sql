-- Persist the sender selected from the bulk WhatsApp dialog so the
-- background worker routes every recipient through the same business number.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS business_phone_number_id text,
  ADD COLUMN IF NOT EXISTS business_phone_number text;

COMMENT ON COLUMN public.whatsapp_campaigns.business_phone_number_id IS
  'Meta phone-number ID selected for a bulk WhatsApp campaign. Null means use the bulk route default.';

COMMENT ON COLUMN public.whatsapp_campaigns.business_phone_number IS
  'Digits-only WhatsApp business sender number selected for a bulk WhatsApp campaign when known.';
