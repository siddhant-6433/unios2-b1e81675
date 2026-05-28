-- Restore `lead_counsellor_ids` on `whatsapp_conversations` — without it the
-- counsellor inbox is empty.
--
-- Migration 20260520114941 added the column so the WhatsApp inbox could filter
-- counsellor rows via `.contains("lead_counsellor_ids", [me])`, which catches
-- the case where the latest message on a phone is a campaign blast
-- (`lead_id = NULL`) or a template tied to another counsellor's lead. The
-- next-day rebaseline (20260521050748) rewrote the function body to fix the
-- security_invoker regression but dropped the `lead_counsellor_ids` return
-- column. The live DB ended up with the older signature, so the client's
-- `.contains("lead_counsellor_ids", ...)` filter fails (PostgREST 400) and
-- the counsellor inbox renders "No conversations yet" even when the user
-- owns leads with unread inbound (124 unread for the reporting counsellor).
--
-- Reapply the 20260520 shape on top of the current definer-fn body so we keep
-- both: the SECURITY DEFINER wrapper (counsellor RLS bypass) and the
-- `lead_counsellor_ids` aggregation. Threat model unchanged — same source
-- rows, one extra derived column.

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
    -- Drives the counsellor inbox filter (.contains lead_counsellor_ids = [me]).
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

-- View-column contract assertion. The counsellor inbox at
-- src/pages/WhatsAppInbox.tsx and the cross-page profile.id callsites
-- depend on this column existing. If a future rebaseline drops it the
-- migration that did so will fail to apply cleanly because this block
-- re-evaluates the schema after CREATE VIEW. Keeps the regression that
-- caused this fix from recurring silently.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'whatsapp_conversations'
      AND column_name = 'lead_counsellor_ids'
  ) THEN
    RAISE EXCEPTION
      'whatsapp_conversations.lead_counsellor_ids is required by the counsellor inbox filter; do not drop without updating src/pages/WhatsAppInbox.tsx';
  END IF;
END
$check$;
