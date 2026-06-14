-- Increase marketing dispatcher throughput.
--
-- The prior single-campaign dispatcher used batch_size 10 to minimize risk
-- while recovering from queue control issues. Once the dispatcher auth path is
-- fixed, that rate is too slow for 900+ recipient campaigns. Keep one active
-- campaign per tick, but process up to 50 recipients per minute.

SELECT cron.unschedule('marketing-campaign-dispatcher')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-campaign-dispatcher');

SELECT cron.schedule(
  'marketing-campaign-dispatcher',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := jsonb_build_object('limit', 1, 'batch_size', 50),
    timeout_milliseconds := 60000
  )
  $$
);
