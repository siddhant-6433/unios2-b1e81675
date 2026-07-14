-- Daily lead intake email.
--
-- Sends "Leads Added Yesterday" with an HTML table + CSV attachment.
-- 18:31 UTC is 00:01 IST.

SELECT cron.unschedule('daily-lead-summary-email')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-lead-summary-email');

SELECT cron.schedule(
  'daily-lead-summary-email',
  '31 18 * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/daily-lead-summary-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := jsonb_build_object('trigger', 'pg_cron'),
    timeout_milliseconds := 25000
  )
  $$
);
