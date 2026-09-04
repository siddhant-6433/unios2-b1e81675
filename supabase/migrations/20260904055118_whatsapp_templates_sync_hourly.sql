-- Sync the WhatsApp template mirror from Meta hourly, not once a day.
--
-- The header-media re-host (Meta's scontent sample → our public storage) and the
-- APPROVED status flip both happen only inside this sync. At the old daily
-- cadence, a template Meta approved during the day could not be campaigned until
-- the next night: the mirror still read PENDING and `whatsapp_template_settings.
-- media_url` was empty, so the campaign builder showed a blank Header media URL
-- and kept Send test disabled. Hourly shrinks that dead window from ~24h to <1h.
-- 159 template reads/hour is trivial. Idempotent: unschedule-then-reschedule.

SELECT cron.unschedule('whatsapp-templates-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-templates-sync');

SELECT cron.schedule(
  'whatsapp-templates-sync',
  '30 * * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-templates',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{"action": "sync"}'::jsonb
    )
  $$
);
