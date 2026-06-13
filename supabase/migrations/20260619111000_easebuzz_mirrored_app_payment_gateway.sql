-- Gateway application-fee callbacks mark applications.payment_status='paid',
-- then this trigger mirrors the application fee into lead_payments for finance
-- views and later ledger application.
--
-- The mirror is secondary bookkeeping. If it fails, the application must still
-- stay paid because the gateway already confirmed money was collected.
--
-- Also stamp gateway on mirrored rows. Later notification triggers skip
-- app-layer/gateway rows because the edge-function payment path already
-- generates receipts/notifications; leaving gateway NULL routes the row
-- through legacy DB notification side effects.

-- ICICI reconciliation marks failed initiate/status attempts as status='failed'.
-- Keep that terminal state inside the DB constraint instead of letting support
-- logging itself fail.
ALTER TABLE public.lead_payments
  DROP CONSTRAINT IF EXISTS lead_payments_status_check;

ALTER TABLE public.lead_payments
  ADD CONSTRAINT lead_payments_status_check
  CHECK (status IN ('pending', 'confirmed', 'refunded', 'failed'));

CREATE OR REPLACE FUNCTION public.fn_mirror_app_payment_to_lead_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gateway text;
BEGIN
  -- Only on transition pending -> paid; only when a lead is attached.
  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.payment_status = 'paid' THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.fee_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_gateway := CASE
      WHEN COALESCE(NEW.payment_ref, '') ILIKE 'MANUAL_%' THEN 'offline'
      WHEN COALESCE(NEW.payment_ref, '') ILIKE 'CASHFREE_%'
        OR COALESCE(NEW.payment_ref, '') ILIKE 'APP_%' THEN 'cashfree'
      WHEN COALESCE(NEW.payment_ref, '') ILIKE 'ICICI_%'
        OR COALESCE(NEW.payment_ref, '') ILIKE 'IC%' THEN 'icici'
      WHEN COALESCE(NEW.payment_ref, '') ILIKE 'RECON_%'
        OR COALESCE(NEW.payment_ref, '') ~ '^E[0-9]' THEN 'easebuzz'
      ELSE 'online'
    END;

    -- Idempotency guards (in priority order):
    --   1. Same transaction_ref already exists for this lead.
    --   2. Same amount + recent confirmed app-fee row.
    IF NEW.payment_ref IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.lead_payments
       WHERE lead_id = NEW.lead_id
         AND type = 'application_fee'
         AND transaction_ref = NEW.payment_ref
    ) THEN
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.lead_payments
       WHERE lead_id = NEW.lead_id
         AND type = 'application_fee'
         AND status = 'confirmed'
         AND amount = NEW.fee_amount
         AND created_at >= now() - interval '24 hours'
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.lead_payments
      (lead_id, type, amount, payment_mode, gateway, transaction_ref, status, payment_date, notes)
    VALUES (
      NEW.lead_id,
      'application_fee',
      NEW.fee_amount,
      'gateway',
      v_gateway,
      NEW.payment_ref,
      'confirmed',
      COALESCE(NEW.updated_at, now()),
      'Auto-mirrored from application ' || NEW.application_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[mirror-app-payment] skipped for application %, lead %, ref %: %',
      NEW.application_id, NEW.lead_id, NEW.payment_ref, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mirror_app_payment_to_lead_payments()
  TO service_role, authenticated;

-- Backfill metadata for rows mirrored before gateway stamping was added.
UPDATE public.lead_payments
   SET gateway = CASE
     WHEN COALESCE(transaction_ref, '') ILIKE 'MANUAL_%' THEN 'offline'
     WHEN COALESCE(transaction_ref, '') ILIKE 'CASHFREE_%'
       OR COALESCE(transaction_ref, '') ILIKE 'APP_%' THEN 'cashfree'
     WHEN COALESCE(transaction_ref, '') ILIKE 'ICICI_%'
       OR COALESCE(transaction_ref, '') ILIKE 'IC%' THEN 'icici'
     WHEN COALESCE(transaction_ref, '') ILIKE 'RECON_%'
       OR COALESCE(transaction_ref, '') ~ '^E[0-9]' THEN 'easebuzz'
     ELSE 'online'
   END
 WHERE gateway IS NULL
   AND payment_mode = 'gateway'
   AND type = 'application_fee'
   AND notes LIKE 'Auto-mirrored from application %';

CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway, '') IN ('offline','easebuzz','icici','cashfree','online') THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'app_fee_paid',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type = 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway, '') IN ('offline','easebuzz','icici','cashfree','online') THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;
