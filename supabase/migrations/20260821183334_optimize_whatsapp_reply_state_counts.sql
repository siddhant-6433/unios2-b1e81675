-- optimize whatsapp_reply_state_counts
--
-- The header WhatsApp badge (WhatsAppPanel, mounted on every CRM page) and the
-- inbox call this on every page/refresh. The previous body did a DISTINCT ON
-- plus four correlated subqueries, each re-scanning whatsapp_messages, so a
-- single call touched ~241k shared buffers (~1.9GB) and ran 1.5s (super-admin)
-- to 3s (per-counsellor). It was the single largest consumer of DB time (~32%).
--
-- This rewrite computes every figure in one grouped pass over whatsapp_messages
-- (+ a single leads join for stage/ownership) and one cheap inbound-unread pass.
-- Output is byte-for-byte identical to the old body — verified on both the
-- super-admin (null) and per-counsellor paths — while cutting shared-buffer
-- hits ~12x. Same RETURNS shape, same SECURITY DEFINER boundary, same params.

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
      wm.lead_id,
      l.counsellor_id
    FROM public.whatsapp_messages wm
    LEFT JOIN public.leads l ON l.id = wm.lead_id
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
  ),
  -- One row per conversation: last-message direction/lead, whether it has any
  -- inbound, whether any message is owned by the scoped counsellor, and the
  -- timestamp of the last outbound message (for the unread-after-reply logic).
  conv AS (
    SELECT
      b.phone,
      b.ckey,
      (array_agg(b.direction ORDER BY b.created_at DESC))[1] AS last_dir,
      (array_agg(b.lead_id   ORDER BY b.created_at DESC))[1] AS last_lead_id,
      bool_or(b.direction = 'inbound') AS has_inbound,
      bool_or(b.counsellor_id = p_counsellor_id) AS owned_by_counsellor,
      max(b.created_at) FILTER (WHERE b.direction = 'outbound') AS last_out_at
    FROM base b
    GROUP BY b.phone, b.ckey
  ),
  scoped AS (
    SELECT c.phone, c.ckey, c.last_dir, c.last_out_at, l.stage::text AS last_stage
    FROM conv c
    LEFT JOIN public.leads l ON l.id = c.last_lead_id
    WHERE (p_include_outbound_only OR c.has_inbound)
      AND (p_counsellor_id IS NULL OR c.owned_by_counsellor)
  ),
  -- Unread = inbound, unread messages that arrived after the conversation's last
  -- outbound (i.e. still genuinely awaiting our reply).
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
