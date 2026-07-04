-- Supabase's Edge Functions gateway requires an Authorization/apikey header
-- even when the function itself accepts x-cron-secret. Keep the existing
-- internal cron auth, but include the configured service key so scheduled
-- dispatcher calls are not rejected before they reach campaign-dispatcher.

SELECT cron.unschedule('marketing-campaign-dispatcher')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-campaign-dispatcher');

SELECT cron.schedule(
  'marketing-campaign-dispatcher',
  '* * * * *',
  $$
  WITH config AS (
    SELECT
      coalesce(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
        (SELECT value FROM public._app_config WHERE key = 'supabase_url')
      ) AS supabase_url,
      (SELECT value FROM public._app_config WHERE key = 'service_role_key') AS service_role_key,
      coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '') AS cron_secret
  )
  SELECT net.http_post(
    url     := config.supabase_url || '/functions/v1/campaign-dispatcher',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || config.service_role_key,
      'apikey',        config.service_role_key,
      'x-cron-secret', config.cron_secret
    ),
    body    := jsonb_build_object('limit', 4, 'batch_size', 30),
    timeout_milliseconds := 55000
  )
  FROM config
  $$
);
