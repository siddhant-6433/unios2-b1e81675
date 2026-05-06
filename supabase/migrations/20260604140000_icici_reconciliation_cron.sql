-- Reconciliation cron for stuck ICICI payments.
--
-- Why: when the user closes the bank popup before ICICI fires the success
-- callback (or when the bank's UAT environment times out), our row stays
-- 'pending' forever. The cron sweeps every 5 minutes, asks ICICI's STATUS
-- API for the truth on each row >10 min old, and settles to confirmed/
-- failed. Idempotent — re-runs on already-settled rows are no-ops because
-- the SELECT filters on status='pending'.

CREATE OR REPLACE FUNCTION public.fn_reconcile_icici_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
  v_pending_count int;
BEGIN
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  -- Skip the dispatch when there's nothing to reconcile — saves a wasted
  -- HTTP round-trip plus an ICICI call.
  SELECT count(*) INTO v_pending_count
  FROM lead_payments
  WHERE gateway = 'icici'
    AND status = 'pending'
    AND transaction_ref IS NOT NULL
    AND created_at < now() - interval '10 minutes';
  IF v_pending_count = 0 THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/icici-payment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('action', 'reconcile-pending')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reconcile_icici_pending TO service_role;

-- Run every 5 minutes. Edge function caps per-run scan at 50 rows so we
-- don't blast ICICI with hundreds of STATUS calls in one tick.
SELECT cron.schedule(
  'reconcile-icici-pending',
  '*/5 * * * *',
  $$SELECT public.fn_reconcile_icici_pending()$$
);
