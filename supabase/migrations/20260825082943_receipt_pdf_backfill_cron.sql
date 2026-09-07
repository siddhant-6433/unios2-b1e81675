-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260825082943 name=receipt_pdf_backfill_cron applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

SELECT cron.unschedule('receipt-pdf-backfill')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'receipt-pdf-backfill');

SELECT cron.schedule(
  'receipt-pdf-backfill',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/receipt-pdf-backfill-cron',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','825230a9abd38418482572ca5ec24dbd06221ffa'),
    body    := '{}'::jsonb
  )
  $$
);

CREATE INDEX IF NOT EXISTS idx_lead_payments_receipt_pending
  ON public.lead_payments (created_at)
  WHERE status = 'confirmed' AND receipt_no IS NOT NULL AND receipt_url IS NULL;
