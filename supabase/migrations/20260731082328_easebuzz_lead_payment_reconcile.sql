-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260731082328 name=easebuzz_lead_payment_reconcile applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Easebuzz lead-payment settlement fallbacks (PR #424).
-- (1) allow the settlement sources the code actually emits (surl, callback);
-- (2) poll Easebuzz for pending lead payments every 10 minutes.

ALTER TABLE public.gateway_settlements
  DROP CONSTRAINT IF EXISTS gateway_settlements_source_check;

ALTER TABLE public.gateway_settlements
  ADD CONSTRAINT gateway_settlements_source_check
  CHECK (source = ANY (ARRAY[
    'webhook', 'verify', 'reconcile', 'cron', 'manual', 'unknown',
    'surl', 'callback'
  ]));

SELECT cron.unschedule('easebuzz-lead-payment-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'easebuzz-lead-payment-reconcile');

SELECT cron.schedule(
  'easebuzz-lead-payment-reconcile',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/easebuzz-payment',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{"action":"reconcile-lead-payments","lookback_days":7}'::jsonb
  )
  $$
);
