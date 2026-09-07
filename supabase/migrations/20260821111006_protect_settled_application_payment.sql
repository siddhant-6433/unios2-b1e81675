-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260821111006 name=protect_settled_application_payment applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.fn_protect_settled_application_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.payment_status = 'paid' THEN
    IF NEW.payment_status IS DISTINCT FROM 'paid' THEN
      NEW.payment_status := 'paid';
    END IF;
    NEW.payment_ref     := COALESCE(NEW.payment_ref,     OLD.payment_ref);
    NEW.fee_receipt_url := COALESCE(NEW.fee_receipt_url, OLD.fee_receipt_url);
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
