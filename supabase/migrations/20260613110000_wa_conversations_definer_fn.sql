-- Restore counsellor visibility into the WhatsApp inbox.
--
-- BUG: 20260610090000_views_security_invoker.sql flipped
-- `whatsapp_conversations` to security_invoker=true. With RLS on `leads`
-- restricting counsellors to rows they own (and stricter
-- `whatsapp_messages` RLS from 20260610010000), the view rewrites pull
-- the underlying-table predicates into the join — and the result for a
-- real counsellor collapses to zero rows even when 11+ unread messages
-- exist on her own leads. Topbar "X unreplied" still works because it
-- queries `whatsapp_messages` directly with an explicit lead-id filter;
-- the inbox uses the view + `.eq("counsellor_id", profile.id)` and ends
-- up empty.
--
-- This is the same shape of regression that `unassigned_leads_bucket`
-- hit, fixed in 20260612110000 by wrapping the body in a SECURITY
-- DEFINER function. We do the same here, restore the
-- `business_phone_number_id` / `business_phone_number` columns the
-- Conversation type still consumes, and keep the per-business-number
-- DISTINCT ON so multi-inbox stays intact.
--
-- Threat model: `whatsapp_messages` SELECT is already gated to staff
-- roles (super_admin, campus_admin, principal, admission_head,
-- counsellor, office_admin) by 20260610010000. The function is GRANTed
-- to authenticated, but non-staff users see zero rows from the messages
-- table anyway, so wrapping with a definer adds no exposure beyond what
-- `whatsapp_messages` already permits. Per-counsellor scoping in the
-- inbox UI is enforced by `.eq("counsellor_id", profile.id)` in
-- src/pages/WhatsAppInbox.tsx, identical to the unassigned-bucket pattern.

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
  has_inbound boolean
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
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound
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
  ORDER BY latest.phone, COALESCE(latest.business_phone_number_id, ''), latest.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO service_role;

DROP VIEW IF EXISTS public.whatsapp_conversations;

CREATE VIEW public.whatsapp_conversations
WITH (security_invoker = true) AS
  SELECT * FROM public.get_whatsapp_conversations();

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;
