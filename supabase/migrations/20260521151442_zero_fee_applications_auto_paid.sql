
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

UPDATE public.applications
   SET payment_status = 'paid'
 WHERE COALESCE(fee_amount, 0) = 0
   AND payment_status IS DISTINCT FROM 'paid';

