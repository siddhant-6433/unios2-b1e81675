-- Fix visit-reminders cron to use hardcoded project URL.
SELECT cron.unschedule('visit-reminders-daily');

SELECT cron.schedule(
  'visit-reminders-daily',
  '30 2 * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/visit-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);
