-- keep-migration-version: restored production migration 20261013122023; preserve its applied version.
-- Imported Schoolknot receipts already carry their source receipt number and
-- must never enter Uni's receipt-number or payment-notification flows.

CREATE OR REPLACE FUNCTION public.fn_assign_receipt_no_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(NEW.gateway, '') = 'schoolknot_archive' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'confirmed'
     AND (NEW.receipt_no IS NULL OR NEW.receipt_no = '') THEN
    NEW.receipt_no := public.next_receipt_no();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway, '') IN ('offline', 'easebuzz', 'icici', 'schoolknot_archive') THEN RETURN NEW; END IF;

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
SET search_path TO public
AS $$
BEGIN
  IF NEW.type = 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway, '') IN ('offline', 'easebuzz', 'icici', 'schoolknot_archive') THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;
