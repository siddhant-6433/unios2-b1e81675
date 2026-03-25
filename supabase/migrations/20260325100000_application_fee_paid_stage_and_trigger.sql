-- Add application_fee_paid to lead_stage enum
ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'application_fee_paid' AFTER 'application_submitted';

-- Trigger: when application payment_status changes to 'paid', update the linked lead's stage
CREATE OR REPLACE FUNCTION public.sync_lead_stage_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.payment_status = 'paid'
    AND (OLD.payment_status IS DISTINCT FROM 'paid')
    AND NEW.lead_id IS NOT NULL
  THEN
    UPDATE public.leads
    SET stage = 'application_fee_paid'
    WHERE id = NEW.lead_id
      AND stage IN ('new_lead', 'application_in_progress');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_application_payment_paid ON public.applications;
CREATE TRIGGER on_application_payment_paid
  AFTER UPDATE OF payment_status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_stage_on_payment();
