ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS render_metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_render_metadata
  ON public.whatsapp_messages (template_key, created_at DESC)
  WHERE message_type = 'template' AND render_metadata IS NOT NULL;
