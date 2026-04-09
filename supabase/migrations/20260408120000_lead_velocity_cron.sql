-- Lead Velocity Cron — runs every 15 minutes
-- Handles SLA enforcement, followup enforcement, visit confirmation calls

SELECT cron.schedule(
  'lead-velocity-check',
  '*/15 * * * *',
  $$
  SELECT
    net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/lead-velocity-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);

-- Also schedule a morning run at 07:30 IST (02:00 UTC) for visit confirmation calls
-- This ensures counsellors get morning alerts for same-day and next-day visits
SELECT cron.schedule(
  'visit-confirmation-morning',
  '0 2 * * *',
  $$
  SELECT
    net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/lead-velocity-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);
