-- Multi-inbox: tag every WhatsApp message with the receiving business phone
-- number so a separate inbox can be shown per number. Existing rows stay NULL
-- and are treated as "primary" by the UI.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS business_phone_number_id text,
  ADD COLUMN IF NOT EXISTS business_phone_number    text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_business_pnid
  ON public.whatsapp_messages (business_phone_number_id);

DROP VIEW IF EXISTS public.whatsapp_conversations;

CREATE OR REPLACE VIEW public.whatsapp_conversations
WITH (security_invoker = false)
AS
SELECT DISTINCT ON (latest.phone, COALESCE(latest.business_phone_number_id, ''))
  latest.phone,
  latest.lead_id,
  l.name AS lead_name,
  l.stage::text AS lead_stage,
  l.person_role AS lead_person_role,
  l.counsellor_id,
  c.name AS course_name,
  latest.content AS last_message,
  latest.direction AS last_direction,
  latest.created_at AS last_message_at,
  latest.assigned_to,
  latest.business_phone_number_id,
  latest.business_phone_number,
  COALESCE(unread.cnt, 0)::integer AS unread_count,
  COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound
FROM public.whatsapp_messages latest
LEFT JOIN public.leads l ON l.id = latest.lead_id
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM public.whatsapp_messages wm2
  WHERE wm2.phone = latest.phone
    AND wm2.direction = 'inbound'
    AND wm2.is_read = false
    AND COALESCE(wm2.business_phone_number_id,'') = COALESCE(latest.business_phone_number_id,'')
) unread ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM public.whatsapp_messages wm3
  WHERE wm3.phone = latest.phone
    AND wm3.direction = 'inbound'
    AND COALESCE(wm3.business_phone_number_id,'') = COALESCE(latest.business_phone_number_id,'')
) inbound ON true
ORDER BY latest.phone, COALESCE(latest.business_phone_number_id, ''), latest.created_at DESC;

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;
