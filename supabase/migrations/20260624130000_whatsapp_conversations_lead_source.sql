DROP VIEW IF EXISTS public.whatsapp_conversations;
DROP FUNCTION IF EXISTS public.get_whatsapp_conversations();

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations()
RETURNS TABLE (
  phone text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  lead_source text,
  counsellor_id uuid,
  counsellor_name text,
  course_name text,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  assigned_to uuid,
  provider text,
  business_phone_number_id text,
  business_phone_number text,
  conversation_mode text,
  conversation_state text,
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text,
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  unread_count integer,
  has_inbound boolean,
  lead_counsellor_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (
    latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  )
    latest.phone,
    latest.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.source::text AS lead_source,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    latest.content AS last_message,
    latest.direction AS last_direction,
    latest.created_at AS last_message_at,
    latest.assigned_to,
    latest.provider,
    latest.business_phone_number_id,
    latest.business_phone_number,
    COALESCE(wcs.mode, 'ai') AS conversation_mode,
    COALESCE(
      wcs.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(wcs.owner_user_id, l.counsellor_id) AS owner_user_id,
    wcs.escalation_role,
    wcs.handoff_reason,
    COALESCE(wcs.priority, 'normal') AS priority,
    wcs.sla_due_at,
    wcs.last_intent,
    wcs.last_confidence,
    wcs.last_bot_action,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids
  FROM public.whatsapp_messages latest
  LEFT JOIN public.leads l ON l.id = latest.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.whatsapp_conversation_state wcs
    ON wcs.phone = latest.phone
   AND wcs.business_number = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm2
    WHERE wm2.phone = latest.phone
      AND wm2.direction = 'inbound'
      AND wm2.is_read = false
      AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm2.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm2.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
      )
  ) unread ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm3
    WHERE wm3.phone = latest.phone
      AND wm3.direction = 'inbound'
      AND public.whatsapp_conversation_key(wm3.provider, wm3.business_phone_number_id, wm3.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  ) inbound ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = latest.phone
      AND public.whatsapp_conversation_key(wm4.provider, wm4.business_phone_number_id, wm4.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  ORDER BY latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number),
    latest.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO service_role;

CREATE VIEW public.whatsapp_conversations
WITH (security_invoker = true) AS
  SELECT * FROM public.get_whatsapp_conversations();

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;
