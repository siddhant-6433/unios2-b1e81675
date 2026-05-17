ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS status_error jsonb;
