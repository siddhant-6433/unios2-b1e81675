-- A 30-recipient WhatsApp batch can complete successfully but exceed the old
-- 25s pg_net timeout. Keep the faster batch size and give the dispatcher
-- enough time to return cleanly.

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
    body    := jsonb_build_object('limit', 4, 'batch_size', 30),
    timeout_milliseconds := 55000
  )
  $$
);
