-- Schedule the entrance-exam registration check cron.
--
-- Runs daily at 04:30 UTC (10:00 IST). The function itself caps each lead at
-- 2 asks spaced >= 7 days apart, so a daily cadence asks new leads within a
-- day of entering the system and re-asks once a week later (max twice) — no
-- separate "on entry" trigger needed. The function also self-guards on the
-- exam_registration_check template being APPROVED, so this is safe to schedule
-- ahead of Meta approval (it no-ops until the template goes live).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: drop any prior schedule with this name before re-creating.
SELECT cron.unschedule('exam-registration-check-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'exam-registration-check-daily');

SELECT cron.schedule(
  'exam-registration-check-daily',
  '30 4 * * *',
  $$
  SELECT net.http_post(
    url     := coalesce(
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
                 (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               ) || '/functions/v1/exam-registration-check-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', coalesce((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1), '')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  $$
);
