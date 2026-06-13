-- Easebuzz application-fee callbacks mark applications.payment_status='paid',
-- then this trigger mirrors the application fee into lead_payments for finance
-- views and later ledger application.
--
-- The mirror is secondary bookkeeping. If it fails, the application must still
-- stay paid because Easebuzz already confirmed money was collected.
--
-- Also stamp gateway='easebuzz' on mirrored rows. Later notification triggers
-- skip gateway-backed rows because the edge-function payment path already
-- generates receipts/notifications; leaving gateway NULL routes the row through
-- legacy DB notification side effects.

CREATE OR REPLACE FUNCTION public.fn_mirror_app_payment_to_lead_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      'easebuzz',
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
   SET gateway = 'easebuzz'
 WHERE gateway IS NULL
   AND payment_mode = 'gateway'
   AND type = 'application_fee'
   AND notes LIKE 'Auto-mirrored from application %';
