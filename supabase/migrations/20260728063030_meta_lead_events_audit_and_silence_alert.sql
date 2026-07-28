-- Meta lead pipeline: durable audit trail + silence alarm.
--
-- Context: the Meta leadgen pipeline (webhook + poll) silently died for 3 weeks
-- on 2026-07-04 when META_PAGE_ACCESS_TOKEN expired. Two gaps let it rot unseen:
--   1. meta-leads-webhook writes each raw event to `meta_lead_events`, but that
--      table was never created — the insert is a swallowed no-op, so there was
--      no durable record of inbound webhooks even when Graph enrichment failed.
--   2. Nothing alerted on zero ingestion. Real volume is ~40-60 leads/day, so a
--      24h stretch with zero leadgen leads is an unambiguous outage signal.
--
-- This migration creates the audit table and a daily silence alarm that writes
-- to the notifications bell for super_admin / admission_head (same channel and
-- dedup approach as report_stale_orphan_applications).

-- ────────── 1. Audit table the webhook already writes to ──────────
CREATE TABLE IF NOT EXISTS public.meta_lead_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leadgen_id   text NOT NULL,
  page_id      text,
  form_id      text,
  ad_id        text,
  adgroup_id   text,
  created_time text,
  raw_event    jsonb,
  status       text NOT NULL DEFAULT 'received',
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_lead_events_leadgen_id_idx
  ON public.meta_lead_events (leadgen_id);
CREATE INDEX IF NOT EXISTS meta_lead_events_received_at_idx
  ON public.meta_lead_events (received_at DESC);

ALTER TABLE public.meta_lead_events ENABLE ROW LEVEL SECURITY;

-- Service role (edge functions) writes; no authenticated read policy needed —
-- this is an internal audit log, not user-facing.
GRANT INSERT, SELECT ON public.meta_lead_events TO service_role;

-- ────────── 2. Daily "zero Meta leads in 24h" silence alarm ──────────
CREATE OR REPLACE FUNCTION public.report_meta_leadgen_silence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count       int;
  v_last        timestamptz;
  v_user        uuid;
BEGIN
  SELECT count(*), max(created_at)
    INTO v_count, v_last
    FROM public.leads
   WHERE meta_leadgen_id IS NOT NULL
     AND created_at > now() - interval '24 hours';

  -- Healthy day => nothing to report.
  IF v_count > 0 THEN
    RETURN;
  END IF;

  FOR v_user IN
    SELECT user_id FROM public.user_roles
     WHERE role IN ('super_admin','admission_head')
  LOOP
    -- Dedup: at most one alert per user per ~20h so a repeated cron
    -- (or a multi-day outage) doesn't spam the bell every run.
    IF EXISTS (
      SELECT 1 FROM public.notifications
       WHERE user_id = v_user
         AND type = 'general'
         AND title = 'Meta lead ingestion has stopped'
         AND created_at > now() - interval '20 hours'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      v_user,
      'general',
      'Meta lead ingestion has stopped',
      format(
        'No Meta ad leads have entered the CRM in the last 24h (last one: %s). '
        || 'This usually means META_PAGE_ACCESS_TOKEN expired or the leadgen webhook '
        || 'subscription lapsed. Check Edge Function secrets and the page''s subscribed_apps.',
        COALESCE(v_last::text, 'more than 24h ago')
      ),
      '/leads?source=meta_ads'
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_meta_leadgen_silence() TO service_role;

-- ────────── 3. Schedule it once daily (07:30 UTC ≈ 13:00 IST) ──────────
-- Pure-SQL call, no net.http_post / cron secret needed.
DO $$
BEGIN
  PERFORM cron.unschedule('meta-leadgen-silence-check');
EXCEPTION WHEN OTHERS THEN
  NULL; -- not yet scheduled
END $$;

SELECT cron.schedule(
  'meta-leadgen-silence-check',
  '30 7 * * *',
  $$ SELECT public.report_meta_leadgen_silence(); $$
);
