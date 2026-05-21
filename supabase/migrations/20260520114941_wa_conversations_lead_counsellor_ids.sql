-- WhatsApp inbox empty for counsellors when an outbound campaign blast (or a
-- template sent on behalf of a different lead/counsellor) becomes the most
-- recent message on a phone.
--
-- The `whatsapp_conversations` view derives `counsellor_id` from
-- `leads.counsellor_id` joined to the LATEST message's `lead_id`. Campaign
-- sends insert `lead_id = NULL` (supabase/functions/whatsapp-campaign-send),
-- and other-counsellor templates point to a different lead. Either case
-- collapses the displayed `counsellor_id` to NULL / another user, so the
-- inbox's `.eq("counsellor_id", profile.id)` filter excludes a phone the
-- counsellor actually owns inbound messages on. The header "X unreplied"
-- pill keeps working because it queries `whatsapp_messages` directly with
-- `lead_id IN (my leads)`, which is why we ended up with the visible
-- mismatch (2 unreplied, 0 conversations).
--
-- Fix: expose `lead_counsellor_ids uuid[]` — distinct counsellor_ids across
-- every message on this phone+inbox. The client filters with array
-- containment; display columns stay tied to the latest message so the row
-- still surfaces the current lead's name/stage/course.
--
-- Threat model unchanged: `whatsapp_messages` SELECT is staff-only via RLS
-- (20260610010000); this function is SECURITY DEFINER as before, just
-- exposing one more derived column over the same source rows.

DROP VIEW IF EXISTS public.whatsapp_conversations;
DROP FUNCTION IF EXISTS public.get_whatsapp_conversations();

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations()
RETURNS TABLE (
  phone text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  counsellor_id uuid,
  counsellor_name text,
  course_name text,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  assigned_to uuid,
  business_phone_number_id text,
  business_phone_number text,
  unread_count integer,
  has_inbound boolean,
  lead_counsellor_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (latest.phone, COALESCE(latest.business_phone_number_id, ''))
    latest.phone,
    latest.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    latest.content AS last_message,
    latest.direction AS last_direction,
    latest.created_at AS last_message_at,
    latest.assigned_to,
    latest.business_phone_number_id,
    latest.business_phone_number,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids
  FROM public.whatsapp_messages latest
  LEFT JOIN public.leads l ON l.id = latest.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
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
  LEFT JOIN LATERAL (
    -- Every counsellor who owns a lead linked to any message on this phone+inbox.
    -- Used by the counsellor inbox filter (.contains lead_counsellor_ids = [me])
    -- so a campaign blast with lead_id=NULL becoming the latest message can no
    -- longer hide the conversation from the counsellor who owns the inbound.
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = latest.phone
      AND COALESCE(wm4.business_phone_number_id,'') = COALESCE(latest.business_phone_number_id,'')
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  ORDER BY latest.phone, COALESCE(latest.business_phone_number_id, ''), latest.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO service_role;

CREATE VIEW public.whatsapp_conversations
WITH (security_invoker = true) AS
  SELECT * FROM public.get_whatsapp_conversations();

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;
