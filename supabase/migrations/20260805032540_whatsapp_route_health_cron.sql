-- WhatsApp AI health watchdog.
--
-- Context: the Gemini API returned 403 "Lightning dunning decision is deny for
-- project: projects/296852661198" from 2026-08-02. Every auto-reply failed for
-- three days and nothing alerted anyone — ai_reply_sent went 414/day to 0 while
-- send_failed climbed to ~130/day.
--
-- whatsapp-route-health now computes an AI health verdict over a 30-minute
-- window and emails siddhant@nimt.ac.in exactly once per incident (state kept in
-- whatsapp_automation_events, event_type = 'route_alert_sent').

SELECT cron.unschedule('whatsapp-route-health')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-route-health');

SELECT cron.schedule(
  'whatsapp-route-health',
  '*/15 * * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-route-health',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);

-- The watchdog counts three event types over a 30-minute window on every run;
-- without this index each run walks the whole event table.
CREATE INDEX IF NOT EXISTS idx_wa_automation_events_type_created
  ON public.whatsapp_automation_events (event_type, created_at DESC);
