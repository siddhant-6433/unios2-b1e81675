-- Sprint 3 Feature 4: Two-Way WhatsApp Inbox

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  wa_message_id text UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone text NOT NULL,
  message_type text DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive')),
  content text,
  media_url text,
  template_key text,
  status text DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received')),
  is_read boolean DEFAULT false,
  read_by uuid REFERENCES public.profiles(id),
  read_at timestamptz,
  assigned_to uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_wa_messages_lead ON public.whatsapp_messages(lead_id, created_at DESC);
CREATE INDEX idx_wa_messages_phone ON public.whatsapp_messages(phone);
CREATE INDEX idx_wa_messages_unread ON public.whatsapp_messages(is_read) WHERE direction = 'inbound' AND is_read = false;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage whatsapp_messages"
  ON public.whatsapp_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime for live inbox updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;

-- Conversations view (latest message per phone)
CREATE OR REPLACE VIEW public.whatsapp_conversations AS
SELECT DISTINCT ON (latest.phone)
  latest.phone,
  latest.lead_id,
  l.name AS lead_name,
  l.stage::text AS lead_stage,
  l.counsellor_id,
  latest.content AS last_message,
  latest.direction AS last_direction,
  latest.created_at AS last_message_at,
  latest.assigned_to,
  COALESCE(unread.cnt, 0)::integer AS unread_count
FROM public.whatsapp_messages latest
LEFT JOIN public.leads l ON l.id = latest.lead_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM public.whatsapp_messages wm2
  WHERE wm2.phone = latest.phone AND wm2.direction = 'inbound' AND wm2.is_read = false
) unread ON true
ORDER BY latest.phone, latest.created_at DESC;

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
