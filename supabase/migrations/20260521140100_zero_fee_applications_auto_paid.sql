-- ====================================================================
-- Zero-fee applications should never show "pending" payment status.
--
-- B.Ed / D.El.Ed (and any program priced at ₹0 in FEE_MAP) have
-- fee_amount = 0 — there is no liability to settle. PR #37 zeroed
-- fee_amount on historical rows but left payment_status='pending',
-- so the UI still rendered a pending badge. Fix:
--
--   1. BEFORE INSERT/UPDATE trigger on applications: when fee_amount
--      is 0/null, force payment_status = 'paid'. Idempotent — won't
--      flip rows that are already paid for a different reason.
--
--   2. Backfill: flip every existing zero-fee pending row.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_zero_fee_applications_auto_paid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.fee_amount, 0) = 0 AND NEW.payment_status IS DISTINCT FROM 'paid' THEN
    NEW.payment_status := 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zero_fee_applications_auto_paid ON public.applications;
CREATE TRIGGER trg_zero_fee_applications_auto_paid
  BEFORE INSERT OR UPDATE OF fee_amount, payment_status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_zero_fee_applications_auto_paid();

-- Backfill
UPDATE public.applications
   SET payment_status = 'paid'
 WHERE COALESCE(fee_amount, 0) = 0
   AND payment_status IS DISTINCT FROM 'paid';
