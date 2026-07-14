-- Payment-link reconciliation cron.
-- Runs every 10 minutes. Polls Razorpay for payment links that are paid on
-- their side but still 'active' in our DB (missed callback + webhook).
-- Settles them idempotently and fires receipt/notification.

SELECT cron.unschedule('payment-link-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-link-reconcile');

SELECT cron.schedule(
  'payment-link-reconcile',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/payment-link-reconcile-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
