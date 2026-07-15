-- Razorpay Standard Checkout: at-most-once settlement ledger.
--
-- Principle: double-marking is worse than a missed mark.
-- gateway_settlements is the global claim key for a gateway payment id
-- (e.g. pay_TCx…). Webhook / verify-payment / reconcile / cron all insert
-- here first (or after a successful claim) so the same capture cannot
-- settle two different entities.
--
-- Soft EXISTS checks in triggers are not enough under concurrency.

CREATE TABLE IF NOT EXISTS public.gateway_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL DEFAULT 'razorpay'
    CHECK (gateway IN ('razorpay', 'easebuzz', 'icici', 'cashfree', 'offline', 'other')),
  gateway_payment_id text NOT NULL,
  gateway_order_id text,
  context text,
  entity_type text,
  entity_id text,
  amount numeric(12, 2),
  source text NOT NULL DEFAULT 'unknown'
    CHECK (source IN ('webhook', 'verify', 'reconcile', 'cron', 'manual', 'unknown')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gateway_settlements_payment_uidx UNIQUE (gateway, gateway_payment_id)
);

CREATE INDEX IF NOT EXISTS gateway_settlements_order_idx
  ON public.gateway_settlements (gateway, gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gateway_settlements_entity_idx
  ON public.gateway_settlements (entity_type, entity_id);

COMMENT ON TABLE public.gateway_settlements IS
  'At-most-once ledger for gateway captures. One gateway_payment_id can settle only once.';

ALTER TABLE public.gateway_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access gateway_settlements" ON public.gateway_settlements;
CREATE POLICY "Service role full access gateway_settlements"
  ON public.gateway_settlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Finance / admission leadership can read for support / audits.
DROP POLICY IF EXISTS "Admins read gateway_settlements" ON public.gateway_settlements;
CREATE POLICY "Admins read gateway_settlements"
  ON public.gateway_settlements
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admission_head')
    OR public.has_role(auth.uid(), 'campus_admin')
  );

GRANT SELECT ON public.gateway_settlements TO authenticated;
GRANT ALL ON public.gateway_settlements TO service_role;

-- Hard uniqueness for gateway-shaped confirmed lead_payments refs.
-- Only when no duplicate keys already exist (skip conflicting rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.lead_payments
     WHERE status = 'confirmed'
       AND transaction_ref IS NOT NULL
       AND transaction_ref ~ '^(pay_|plink_)'
     GROUP BY transaction_ref
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS lead_payments_confirmed_gateway_ref_uidx
      ON public.lead_payments (transaction_ref)
      WHERE status = 'confirmed'
        AND transaction_ref IS NOT NULL
        AND transaction_ref ~ '^(pay_|plink_)';
  ELSE
    RAISE NOTICE 'Skipping lead_payments gateway ref unique index — duplicate confirmed pay_/plink_ refs exist';
  END IF;
END $$;

-- One paid application per gateway payment_ref (pay_ / E / IC shapes).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.applications
     WHERE payment_status = 'paid'
       AND payment_ref IS NOT NULL
       AND payment_ref ~ '^(pay_|E|IC|order_)'
     GROUP BY payment_ref
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS applications_paid_gateway_ref_uidx
      ON public.applications (payment_ref)
      WHERE payment_status = 'paid'
        AND payment_ref IS NOT NULL
        AND payment_ref ~ '^(pay_|E|IC|order_)';
  ELSE
    RAISE NOTICE 'Skipping applications payment_ref unique index — duplicate paid refs exist';
  END IF;
END $$;

-- Clear stale payment_pending flag when an application is marked paid.
CREATE OR REPLACE FUNCTION public.fn_clear_payment_pending_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND (OLD.payment_status IS DISTINCT FROM 'paid')
     AND NEW.flags IS NOT NULL
     AND NEW.flags @> ARRAY['payment_pending']::text[]
  THEN
    NEW.flags := array_remove(NEW.flags, 'payment_pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_payment_pending_flag ON public.applications;
CREATE TRIGGER trg_clear_payment_pending_flag
  BEFORE UPDATE OF payment_status ON public.applications
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.fn_clear_payment_pending_flag();

-- Cron: reconcile stranded Razorpay Standard Checkout orders every 5 minutes.
SELECT cron.unschedule('razorpay-order-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'razorpay-order-reconcile');

SELECT cron.schedule(
  'razorpay-order-reconcile',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/razorpay-payment?action=reconcile-stranded',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{"action":"reconcile-stranded"}'::jsonb
  )
  $$
);
