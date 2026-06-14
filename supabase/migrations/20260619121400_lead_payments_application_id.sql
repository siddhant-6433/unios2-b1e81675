-- Tie application-fee payment rows to the exact application they paid for.
-- A lead can have multiple applications, so deriving receipt notifications from
-- the latest application for the lead can produce the wrong APP-* id.

ALTER TABLE public.lead_payments
  ADD COLUMN IF NOT EXISTS application_id text;

CREATE INDEX IF NOT EXISTS idx_lead_payments_application_id
  ON public.lead_payments(application_id)
  WHERE application_id IS NOT NULL;

COMMENT ON COLUMN public.lead_payments.application_id IS
  'Application id associated with application_fee payments. Avoids lead-level latest-application ambiguity.';

UPDATE public.lead_payments lp
SET application_id = (regexp_match(lp.notes, '(APP-[0-9]{2}-[A-Z0-9]+)'))[1]
WHERE lp.application_id IS NULL
  AND lp.type = 'application_fee'
  AND regexp_match(lp.notes, '(APP-[0-9]{2}-[A-Z0-9]+)') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.application_id = (regexp_match(lp.notes, '(APP-[0-9]{2}-[A-Z0-9]+)'))[1]
      AND a.lead_id = lp.lead_id
  );

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

  IF NEW.payment_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lead_payments
     WHERE lead_id = NEW.lead_id
       AND type = 'application_fee'
       AND transaction_ref = NEW.payment_ref
  ) THEN
    UPDATE public.lead_payments
       SET application_id = COALESCE(application_id, NEW.application_id)
     WHERE lead_id = NEW.lead_id
       AND type = 'application_fee'
       AND transaction_ref = NEW.payment_ref
       AND application_id IS NULL;
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
    UPDATE public.lead_payments
       SET application_id = COALESCE(application_id, NEW.application_id)
     WHERE lead_id = NEW.lead_id
       AND type = 'application_fee'
       AND status = 'confirmed'
       AND amount = NEW.fee_amount
       AND created_at >= now() - interval '24 hours'
       AND application_id IS NULL;
    RETURN NEW;
  END IF;

  INSERT INTO public.lead_payments
    (lead_id, type, amount, payment_mode, transaction_ref, status, payment_date, notes, application_id)
  VALUES (
    NEW.lead_id,
    'application_fee',
    NEW.fee_amount,
    'gateway',
    NEW.payment_ref,
    'confirmed',
    COALESCE(NEW.updated_at, now()),
    'Auto-mirrored from application ' || NEW.application_id,
    NEW.application_id
  );

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mirror_app_payment_to_lead_payments() TO service_role, authenticated;
