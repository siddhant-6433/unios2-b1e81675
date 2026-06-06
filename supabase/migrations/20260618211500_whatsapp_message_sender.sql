-- Attribute outbound WhatsApp messages to the authenticated backend user that
-- sent them. NULL means system/automation/legacy row.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sender_user_id
  ON public.whatsapp_messages (sender_user_id)
  WHERE sender_user_id IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_messages.sender_user_id IS
  'Authenticated user who sent this outbound WhatsApp message from the backend. NULL for automation, inbound, and legacy rows.';
