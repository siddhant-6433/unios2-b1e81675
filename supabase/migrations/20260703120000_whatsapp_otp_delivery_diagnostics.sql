ALTER TABLE public.whatsapp_otps
  ADD COLUMN IF NOT EXISTS wa_message_id text,
  ADD COLUMN IF NOT EXISTS wa_status text,
  ADD COLUMN IF NOT EXISTS wa_status_error jsonb,
  ADD COLUMN IF NOT EXISTS wa_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS wa_status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_whatsapp_otps_wa_message_id
  ON public.whatsapp_otps (wa_message_id)
  WHERE wa_message_id IS NOT NULL;
