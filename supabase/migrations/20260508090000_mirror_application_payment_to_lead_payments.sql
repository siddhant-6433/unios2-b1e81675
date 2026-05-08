-- ====================================================================
-- Mirror application-fee payments into lead_payments.
--
-- Architectural gap: the apply-portal payment flow updates only
-- applications.payment_status='paid'. It never writes a corresponding
-- lead_payments row, so:
--   1. Receipts tab (queries v_all_payments = payments ∪ lead_payments)
--      doesn't show paid application fees.
--   2. provision_student_fees() at AN issuance applies application_fee
--      lead_payments to fee_ledger — but they never exist for these
--      candidates, so the form-fee ledger row stays unpaid even though
--      money was received.
--
-- Fix: AFTER UPDATE trigger on applications.payment_status. When the
-- transition is pending→paid AND the application has a lead_id, insert
-- a lead_payments row (type=application_fee, status=confirmed). The
-- existing handle_lead_payment_change trigger then auto-generates a
-- receipt_no and (post-AN) credits the form fee in fee_ledger.
--
-- Idempotent — guarded against re-fire on the same transaction_ref.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_mirror_app_payment_to_lead_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only on transition pending → paid; only when a lead is attached.
  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.payment_status = 'paid' THEN
    RETURN NEW;  -- already paid; nothing to mirror
  END IF;
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.fee_amount, 0) <= 0 THEN
    RETURN NEW;  -- zero-fee applications (waiver, comp) — nothing to record
  END IF;

  -- Idempotency guards (in priority order):
  --   1. Same transaction_ref already exists for this lead.
  --   2. Same amount + recent (created within 1 day of the application
  --      being marked paid) — covers manual reconciles where the
  --      transaction_ref shape might differ.
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
    (lead_id, type, amount, payment_mode, transaction_ref, status, payment_date, notes)
  VALUES (
    NEW.lead_id,
    'application_fee',
    NEW.fee_amount,
    'gateway',
    NEW.payment_ref,
    'confirmed',
    COALESCE(NEW.updated_at, now()),
    'Auto-mirrored from application ' || NEW.application_id
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mirror_app_payment_to_lead_payments() TO service_role, authenticated;

DROP TRIGGER IF EXISTS trg_mirror_app_payment_to_lead_payments ON public.applications;
CREATE TRIGGER trg_mirror_app_payment_to_lead_payments
  AFTER UPDATE OF payment_status ON public.applications
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION public.fn_mirror_app_payment_to_lead_payments();

-- ────────── Backfill: existing paid applications → lead_payments ───
-- Walks every application where payment_status='paid' + lead_id is set
-- and inserts a corresponding lead_payments row if one doesn't already
-- exist. Same idempotency rules as the trigger so safe to re-run.

DO $$
DECLARE
  v_app RECORD;
  v_inserted int := 0;
  v_skipped  int := 0;
BEGIN
  FOR v_app IN
    SELECT a.application_id, a.lead_id, a.fee_amount, a.payment_ref, a.updated_at
      FROM public.applications a
     WHERE a.payment_status = 'paid'
       AND a.lead_id IS NOT NULL
       AND COALESCE(a.fee_amount, 0) > 0
  LOOP
    -- Same idempotency as the trigger
    IF v_app.payment_ref IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.lead_payments
       WHERE lead_id = v_app.lead_id
         AND type = 'application_fee'
         AND transaction_ref = v_app.payment_ref
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.lead_payments
       WHERE lead_id = v_app.lead_id
         AND type = 'application_fee'
         AND status = 'confirmed'
         AND amount = v_app.fee_amount
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.lead_payments
      (lead_id, type, amount, payment_mode, transaction_ref, status, payment_date, notes)
    VALUES (
      v_app.lead_id,
      'application_fee',
      v_app.fee_amount,
      'gateway',
      v_app.payment_ref,
      'confirmed',
      COALESCE(v_app.updated_at, now()),
      'Backfill from paid application ' || v_app.application_id
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE '[mirror-app-payment-backfill] inserted: %, skipped (already had row): %', v_inserted, v_skipped;
END $$;
