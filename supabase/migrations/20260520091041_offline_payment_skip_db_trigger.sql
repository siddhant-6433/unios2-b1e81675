-- Skip the pg_net notify-event trigger for offline (manual) payment rows.
-- Rationale: OfflinePaymentDialog now invokes notify-event directly from
-- the client right after the insert, because the pg_net-based path has been
-- observed to silently drop in production (config drift, ext load order).
-- Gating both notify functions on `gateway <> 'offline'` keeps the gateway
-- flows (easebuzz, icici) working as before while preventing duplicate
-- WhatsApp / email sends for manual receipts.

CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  -- Offline rows are notified client-side from OfflinePaymentDialog.
  IF COALESCE(NEW.gateway, '') = 'offline' THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'app_fee_paid',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_payment_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type = 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  -- Offline rows are notified client-side from OfflinePaymentDialog.
  IF COALESCE(NEW.gateway, '') = 'offline' THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;
