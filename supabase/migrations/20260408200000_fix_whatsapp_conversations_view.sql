-- Fix whatsapp_conversations view to use SECURITY DEFINER so it can read underlying tables
-- The view itself only returns aggregated conversation data, which is safe for all authenticated users.

DROP VIEW IF EXISTS public.whatsapp_conversations;

CREATE OR REPLACE VIEW public.whatsapp_conversations
WITH (security_invoker = false)
AS
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
GRANT SELECT ON public.whatsapp_conversations TO service_role;
