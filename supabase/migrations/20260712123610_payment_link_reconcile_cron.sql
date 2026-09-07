-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712123610 name=payment_link_reconcile_cron applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
