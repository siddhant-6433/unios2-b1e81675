-- Poll Zoho Books every 15 minutes for paid consultant-payout bills and sync
-- them back to UniOs (Zoho webhooks need a paid plan; polling doesn't).
SELECT cron.unschedule('zoho-books-poll')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zoho-books-poll');

SELECT cron.schedule(
  'zoho-books-poll',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/zoho-books-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
