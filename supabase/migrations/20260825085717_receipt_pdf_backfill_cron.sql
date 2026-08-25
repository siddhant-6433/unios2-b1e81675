-- Schedule receipt-pdf-backfill-cron every 10 minutes.
--
-- lead_payments.receipt_url is only written by generate-payment-receipt, and gateway
-- settlement mints it via a fire-and-forget notify-event chain (easebuzz/icici skip the
-- DB-trigger fallback). When that best-effort call drops, the receipt is stuck on
-- "Generating…" forever with no retry. This cron sweeps confirmed payments that have a
-- receipt number but no PDF and re-runs the generator (also clears the historical
-- backlog on first run).

SELECT cron.unschedule('receipt-pdf-backfill')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'receipt-pdf-backfill');

SELECT cron.schedule(
  'receipt-pdf-backfill',
  '*/10 * * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/receipt-pdf-backfill-cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);

-- The sweep filters confirmed payments with a receipt_no but null receipt_url; index it
-- so each run does not walk the whole table.
CREATE INDEX IF NOT EXISTS idx_lead_payments_receipt_pending
  ON public.lead_payments (created_at)
  WHERE status = 'confirmed' AND receipt_no IS NOT NULL AND receipt_url IS NULL;
