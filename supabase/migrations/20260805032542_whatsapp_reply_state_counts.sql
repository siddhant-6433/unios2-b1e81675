-- One authoritative "needs reply" number for the WhatsApp surfaces.
--
-- Context: the header pill read "10 unreplied" while the inbox listed "All 30",
-- and neither number was wrong — they measured different things:
--
--   pill  = unread inbound MESSAGES (action_badge_counts.wa_unread, SECURITY
--           INVOKER, so RLS applies)
--   list  = CONVERSATIONS that ever received an inbound (has_inbound), capped at
--           the first 120 loaded rows, with no unreplied filter at all, read
--           through a view that wraps a SECURITY DEFINER function and therefore
--           bypasses RLS
--
-- They could never agree. This function replaces both with conversation-level
-- reply state, scoped the way the inbox list scopes itself, so the pill and the
-- "Needs Reply" chip are the same population counted the same way.
--
-- Performance note: the obvious implementation — aggregate over
-- public.whatsapp_conversations — runs in 7.3s against production, right on the
-- 8s statement timeout, because the view materialises a DISTINCT ON plus three
-- LATERAL subqueries for all ~3.8k conversations before anything is counted.
-- (Same trap as the client-side aggregates that used to silently kill the inbox
-- panels.) Reading whatsapp_messages directly gives identical results in ~1.2s.
-- Verified against the view on 2026-08-05: needs_reply 1339, awaiting_them 2362,
-- unread_messages 1898, total 3782 — exact match on all four.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation_key_created
  ON public.whatsapp_messages (
    phone,
    public.whatsapp_conversation_key(provider, business_phone_number_id, business_phone_number),
    created_at DESC
  );

CREATE OR REPLACE FUNCTION public.whatsapp_reply_state_counts(
  p_counsellor_id         uuid    DEFAULT NULL,
  p_business_key          text    DEFAULT NULL,
  p_include_outbound_only boolean DEFAULT false
)
RETURNS TABLE (
  needs_reply     integer,
  awaiting_them   integer,
  unread_messages integer,
  total           integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH last_msg AS (
    SELECT DISTINCT ON (wm.phone, public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number))
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.direction,
      wm.lead_id
    FROM public.whatsapp_messages wm
    -- 'unattributed' is the inbox UI's "primary" tab: conversations with no
    -- business_phone_number_id. Every named number is its own inbox there, so
    -- the counts have to be scoped the same way or the chips advertise
    -- conversations that live on a different tab.
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
    ORDER BY wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number),
      wm.created_at DESC
  ),
  scoped AS (
    SELECT m.phone, m.ckey, m.direction, l.stage::text AS lead_stage
    FROM last_msg m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    WHERE
      -- Inbox population: threads that have actually received something.
      (p_include_outbound_only OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages i
        WHERE i.phone = m.phone
          AND i.direction = 'inbound'
          AND public.whatsapp_conversation_key(i.provider, i.business_phone_number_id, i.business_phone_number) = m.ckey
      ))
      -- Counsellor scoping mirrors the list query's lead_counsellor_ids filter:
      -- any lead on this conversation belongs to them. NULL means no scoping
      -- (admin view), so callers must pass their own id explicitly.
      AND (p_counsellor_id IS NULL OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages c
        JOIN public.leads cl ON cl.id = c.lead_id
        WHERE c.phone = m.phone
          AND public.whatsapp_conversation_key(c.provider, c.business_phone_number_id, c.business_phone_number) = m.ckey
          AND cl.counsellor_id = p_counsellor_id
      ))
  ),
  -- Same predicate as whatsapp_conversations.unread_count: unread inbound with
  -- no outbound sent after it. LATERAL so the join cannot multiply rows — a
  -- plain join here over-counted 9493 against the view's 1898.
  unread AS (
    SELECT COALESCE(SUM(u.cnt), 0)::integer AS total_unread
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM public.whatsapp_messages wm2
      WHERE wm2.phone = s.phone
        AND wm2.direction = 'inbound'
        AND wm2.is_read = false
        AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number) = s.ckey
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_messages r
          WHERE r.phone = wm2.phone
            AND r.direction = 'outbound'
            AND r.created_at > wm2.created_at
            AND public.whatsapp_conversation_key(r.provider, r.business_phone_number_id, r.business_phone_number) = s.ckey
        )
    ) u
  )
  SELECT
    -- Reply state, not read state: a thread stays here until someone actually
    -- replies. Merely opening it (which flips is_read for the whole thread via
    -- mark_whatsapp_conversation_read) no longer makes the work disappear.
    COUNT(*) FILTER (WHERE s.direction = 'inbound' AND COALESCE(s.lead_stage,'') <> 'dnc')::integer,
    COUNT(*) FILTER (WHERE s.direction = 'outbound')::integer,
    (SELECT total_unread FROM unread),
    COUNT(*)::integer
  FROM scoped s;
$fn$;

COMMENT ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) IS
  'Conversation-level WhatsApp reply state (needs_reply / awaiting_them / unread_messages / total), scoped identically to the inbox list query. Single source for the header pill and the inbox filter chips.';

REVOKE ALL ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) TO authenticated;
