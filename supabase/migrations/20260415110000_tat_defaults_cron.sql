-- Schedule TAT defaults report cron: every 2 hours from 9 AM to 5 PM IST (Mon-Sat)
-- IST = UTC+5:30, so 9:00 IST = 3:30 UTC, 11:00 IST = 5:30 UTC, etc.
-- Using minutes 30 to align with IST half-hour offset

SELECT cron.schedule(
  'tat-defaults-report',
  '30 3,5,7,9,11 * * 1-6',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/tat-defaults-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
