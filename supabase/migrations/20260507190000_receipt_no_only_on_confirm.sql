-- Receipt number should only exist for confirmed payments.
--
-- Before: lead_payments_assign_receipt_no fired BEFORE INSERT regardless
-- of status, so every gateway-initiated row (status=pending) consumed a
-- receipt number. If the payment failed or was abandoned, the number was
-- already burned and showed up in receipts/messaging tied to incomplete
-- transactions.
--
-- After: receipt_no is allocated lazily — only when the payment row's
-- status is (or becomes) 'confirmed'. Pending/failed rows keep
-- receipt_no NULL until they're confirmed.

CREATE OR REPLACE FUNCTION public.fn_assign_receipt_no_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the old INSERT-only trigger with one that fires on both INSERT
-- and UPDATE OF status, gated by a confirmed-status WHEN clause so we
-- don't waste sequence numbers on pending rows.
DROP TRIGGER IF EXISTS lead_payments_assign_receipt_no ON public.lead_payments;

CREATE TRIGGER lead_payments_assign_receipt_no
  BEFORE INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND (NEW.receipt_no IS NULL OR NEW.receipt_no = ''))
  EXECUTE FUNCTION public.fn_assign_receipt_no_on_confirm();

-- Clean up: drop receipt_no (and any receipt_url) from existing
-- non-confirmed rows. They were assigned by the old trigger but should
-- not have been.
UPDATE public.lead_payments
   SET receipt_no  = NULL,
       receipt_url = NULL
 WHERE status <> 'confirmed'
   AND (receipt_no IS NOT NULL OR receipt_url IS NOT NULL);
