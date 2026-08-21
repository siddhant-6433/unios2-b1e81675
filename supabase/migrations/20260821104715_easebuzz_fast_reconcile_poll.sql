-- Fast Easebuzz reconcile poll — the substitute for an S2S webhook.
--
-- The Easebuzz dashboard allows one webhook URL per merchant key, and ours is
-- already pointed at the legacy SchoolKnot ERP
-- (https://schoolknot.com/webhooks/updateEasebuzzOnlineTransactions.php).
-- Repointing it would break that ERP's payment updates, so UniOs settles by
-- polling instead. To keep the gap small enough that nobody notices, run a
-- 2-minute sweep over a 3-hour window (a UPI-intent payment resolves within
-- minutes), and let the existing sweep handle stragglers.
--
-- The wide sweep drops from every 10 minutes to hourly: it re-retrieved every
-- pending row of the last 7 days on every tick (~40 rows x 144 ticks/day).
-- The narrow window makes the fast poll cheap — usually 0-5 rows per tick.

SELECT cron.unschedule('easebuzz-lead-payment-reconcile-fast')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'easebuzz-lead-payment-reconcile-fast');

SELECT cron.schedule(
  'easebuzz-lead-payment-reconcile-fast',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
           || '/functions/v1/easebuzz-payment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body := '{"action":"reconcile-lead-payments","window_minutes":180}'::jsonb,
    timeout_milliseconds := 100000
  )
  $$
);

-- Wide safety net: hourly, still 7 days back.
SELECT cron.unschedule('easebuzz-lead-payment-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'easebuzz-lead-payment-reconcile');

SELECT cron.schedule(
  'easebuzz-lead-payment-reconcile',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
           || '/functions/v1/easebuzz-payment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body := '{"action":"reconcile-lead-payments","lookback_days":7}'::jsonb,
    timeout_milliseconds := 300000
  )
  $$
);
