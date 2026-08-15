-- The counselling-watch cron authenticated with _app_config.service_role_key,
-- which has drifted from the edge function's SUPABASE_SERVICE_ROLE_KEY — every
-- scheduled run 401'd silently, so Navya never received a single live
-- counselling date and answered round questions from its own priors instead
-- (it told a BPT lead in mid-August that counselling "hasn't started yet").
--
-- Switch to the vault CRON_SECRET header, the pattern every other working cron
-- in this project uses (daily-lead-summary-email, marketing dispatcher, etc.).
-- The function accepts either credential.

SELECT cron.unschedule('counselling-watch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'counselling-watch');

-- Twice daily at 07:00 and 15:00 IST (01:30 / 09:30 UTC) — round notices move
-- by the day, not the hour.
SELECT cron.schedule(
  'counselling-watch',
  '30 1,9 * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/counselling-watch',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  $$
);
