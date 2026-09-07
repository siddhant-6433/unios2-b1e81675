-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260902083226 name=whatsapp_reply_state_counts_perf applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.whatsapp_reply_state_counts(
  p_counsellor_id uuid DEFAULT NULL::uuid,
  p_business_key text DEFAULT NULL::text,
  p_include_outbound_only boolean DEFAULT false
)
RETURNS TABLE(needs_reply integer, awaiting_them integer, unread_messages integer, total integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.direction,
      wm.created_at,
      wm.is_read,
      wm.lead_id
    FROM public.whatsapp_messages wm
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
  ),
  conv AS (
    SELECT
      b.phone,
      b.ckey,
      (array_agg(b.direction ORDER BY b.created_at DESC))[1] AS last_dir,
      (array_agg(b.lead_id   ORDER BY b.created_at DESC))[1] AS last_lead_id,
      bool_or(b.direction = 'inbound') AS has_inbound,
      max(b.created_at) FILTER (WHERE b.direction = 'outbound') AS last_out_at,
      array_agg(DISTINCT b.lead_id) FILTER (WHERE b.lead_id IS NOT NULL) AS lead_ids
    FROM base b
    GROUP BY b.phone, b.ckey
  ),
  scoped AS (
    SELECT c.phone, c.ckey, c.last_dir, c.last_out_at, l.stage::text AS last_stage
    FROM conv c
    LEFT JOIN public.leads l ON l.id = c.last_lead_id
    WHERE (p_include_outbound_only OR c.has_inbound)
      AND (p_counsellor_id IS NULL OR EXISTS (
            SELECT 1 FROM public.leads o
            WHERE o.id = ANY(c.lead_ids) AND o.counsellor_id = p_counsellor_id))
  ),
  unread AS (
    SELECT COALESCE(SUM(z.cnt), 0)::integer AS total_unread
    FROM (
      SELECT b.phone, b.ckey, COUNT(*) AS cnt
      FROM base b
      JOIN scoped s USING (phone, ckey)
      WHERE b.direction = 'inbound'
        AND b.is_read = false
        AND b.created_at > COALESCE(s.last_out_at, '-infinity'::timestamptz)
      GROUP BY b.phone, b.ckey
    ) z
  )
  SELECT
    COUNT(*) FILTER (WHERE s.last_dir = 'inbound' AND COALESCE(s.last_stage, '') <> 'dnc')::integer,
    COUNT(*) FILTER (WHERE s.last_dir = 'outbound')::integer,
    (SELECT total_unread FROM unread),
    COUNT(*)::integer
  FROM scoped s;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.whatsapp_reply_state_counts_v2(uuid, text, boolean);
