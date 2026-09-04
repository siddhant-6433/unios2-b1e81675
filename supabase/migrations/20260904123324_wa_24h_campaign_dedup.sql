-- Proactive 24h cross-campaign dedup ------------------------------------------
--
-- Meta caps marketing templates at ~2 per user per 24h across ALL businesses.
-- The existing whatsapp_send_suppression system reacts AFTER 131049 failures.
-- This adds a proactive check: skip phones that already received a marketing
-- campaign message from ANY campaign in the last 24 hours, before attempting
-- the send.
--
-- ponytail: uses whatsapp_campaign_recipients as source of truth (no new table),
-- partial functional index keeps it fast even at millions of rows.

-- 1. Index for the 24h lookback ------------------------------------------------
-- Functional index on normalised phone + sent_at, filtered to successful sends.
-- wa_normalize_phone is IMMUTABLE so Postgres can use it in the index.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wcr_phone_sent_24h
  ON public.whatsapp_campaign_recipients (
    public.wa_normalize_phone(phone),
    sent_at DESC
  )
  WHERE status = 'sent' AND sent_at IS NOT NULL;

-- 2. Batch lookup: which of these phones were sent in the last 24h? -----------
-- Same shape as wa_suppressed_phones: takes text[], returns TABLE(phone text).

CREATE OR REPLACE FUNCTION public.wa_recently_sent_phones(_phones text[])
RETURNS TABLE(phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT public.wa_normalize_phone(r.phone) AS phone
    FROM public.whatsapp_campaign_recipients r
   WHERE r.status = 'sent'
     AND r.sent_at > now() - interval '24 hours'
     AND public.wa_normalize_phone(r.phone) = ANY (
           SELECT public.wa_normalize_phone(p) FROM unnest(_phones) p
         );
$$;

GRANT EXECUTE ON FUNCTION public.wa_recently_sent_phones(text[]) TO authenticated, service_role;
