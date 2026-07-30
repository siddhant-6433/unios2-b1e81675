-- Easebuzz lead-payment settlement fallbacks.
--
-- Krishan Kumar paid Rs 5,000 (easepayid E26073013C6EKP) by UPI on 2026-07-30,
-- never returned to the browser, so the surl POST never fired and his
-- lead_payments row sat 'pending' — no receipt, no stage advance. The two
-- fallbacks that should have caught it were both dead:
--   1. gateway_settlements rejected source='surl' (see below), and
--   2. nothing polled Easebuzz for pending lead_payments.
--
-- (2) is fixed by easebuzz-payment's new reconcile-lead-payments action,
-- scheduled here. (1) is fixed by the CHECK below.

-- ── 1. Allow the settlement sources the code actually emits ──────────────
-- gateway-settlement.ts passes source='surl' (browser return POST) and
-- 'callback'. The original CHECK omitted both, so every Easebuzz/ICICI surl
-- settlement violated it. The violation message contains the string
-- "gateway_settlements", which claimGatewayPayment treats as
-- "ledger table unavailable" and fails OPEN — so the at-most-once ledger has
-- been silently recording nothing for gateway surl settlements since
-- 2026-07-15. Entity-level pending→confirmed guards held, but the net was off.
ALTER TABLE public.gateway_settlements
  DROP CONSTRAINT IF EXISTS gateway_settlements_source_check;

ALTER TABLE public.gateway_settlements
  ADD CONSTRAINT gateway_settlements_source_check
  CHECK (source = ANY (ARRAY[
    'webhook', 'verify', 'reconcile', 'cron', 'manual', 'unknown',
    'surl', 'callback'
  ]));

-- ── 2. Poll Easebuzz for pending lead payments every 10 minutes ──────────
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
