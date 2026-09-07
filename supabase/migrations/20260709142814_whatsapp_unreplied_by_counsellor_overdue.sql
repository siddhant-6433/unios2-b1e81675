-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260709142814 name=whatsapp_unreplied_by_counsellor_overdue applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP FUNCTION IF EXISTS public.whatsapp_unreplied_by_counsellor();

CREATE OR REPLACE FUNCTION public.whatsapp_unreplied_by_counsellor()
RETURNS TABLE(
  counsellor_id uuid,
  unread_count bigint,
  overdue_count bigint,
  oldest_unreplied_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    l.counsellor_id,
    COUNT(*)::bigint AS unread_count,
    COUNT(*) FILTER (WHERE wm.created_at < now() - interval '15 minutes')::bigint AS overdue_count,
    MIN(wm.created_at) AS oldest_unreplied_at
  FROM public.whatsapp_messages wm
  LEFT JOIN public.leads l ON l.id = wm.lead_id
  WHERE wm.direction = 'inbound'
    AND wm.is_read = false
    AND NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_messages replied
      WHERE replied.phone = wm.phone
        AND replied.direction = 'outbound'
        AND replied.created_at > wm.created_at
        AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
          = public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
    )
  GROUP BY l.counsellor_id;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_unreplied_by_counsellor() TO authenticated;
