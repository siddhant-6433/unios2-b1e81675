-- Cron to handle failed AI calls that were cleaned up without status callbacks.
-- Runs every 30 minutes during business hours (9 AM - 8 PM IST, Mon-Sat).
-- Handles retry queueing (< 3 attempts) and round-robin assignment (>= 3).

SELECT cron.schedule(
  'ai-call-failed-handler',
  '*/30 3-14 * * 1-6',   -- Every 30 min, 3:00-14:30 UTC = ~8:30 AM - 8 PM IST
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/ai-call-failed-handler',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
