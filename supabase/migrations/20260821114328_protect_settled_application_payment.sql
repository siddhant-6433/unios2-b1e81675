-- protect settled application payment
--
-- Backstop against stale/regressive writes that un-pay a settled application.
-- A stale applicant-portal editor snapshot (or any future writer) was able to
-- flush payment_status back to 'pending' and null payment_ref/fee_receipt_url,
-- leaving a paid candidate stuck re-prompted for payment. No legitimate flow
-- ever transitions a paid application back to pending, so once paid we pin the
-- settlement-owned columns. BEFORE UPDATE so it runs ahead of the existing
-- AFTER mirror/audit triggers; it never blocks the pending->paid settlement.

CREATE OR REPLACE FUNCTION public.fn_protect_settled_application_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payment_status = 'paid' THEN
    -- Ignore attempts to un-pay; keep the settled status.
    IF NEW.payment_status IS DISTINCT FROM 'paid' THEN
      NEW.payment_status := 'paid';
    END IF;
    -- Never lose the settlement reference or the generated receipt URL.
    NEW.payment_ref     := COALESCE(NEW.payment_ref,     OLD.payment_ref);
    NEW.fee_receipt_url := COALESCE(NEW.fee_receipt_url, OLD.fee_receipt_url);
    -- The payment step must stay marked complete so the portal gate re-enables.
    IF NEW.completed_sections IS DISTINCT FROM OLD.completed_sections THEN
      NEW.completed_sections := jsonb_set(
        COALESCE(NEW.completed_sections, '{}'::jsonb),
        '{payment}', 'true'::jsonb, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_settled_application_payment ON public.applications;
CREATE TRIGGER trg_protect_settled_application_payment
  BEFORE UPDATE ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_settled_application_payment();
