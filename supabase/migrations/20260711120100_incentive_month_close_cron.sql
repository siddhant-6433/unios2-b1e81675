-- Incentive month close for the previous month.
-- Runs 22:01 UTC on the 1st = 03:31 IST on the 2nd, giving last-minute
-- payments a full day to land before statements are generated.

SELECT cron.unschedule('incentive-month-close')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'incentive-month-close');

SELECT cron.schedule(
  'incentive-month-close',
  '1 22 1 * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/incentive-month-close-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key'),
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := jsonb_build_object('trigger', 'pg_cron'),
    timeout_milliseconds := 55000
  )
  $$
);
