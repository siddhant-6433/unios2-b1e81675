-- Skip DB-trigger payment notifications for every gateway that already
-- invokes notify-event from the application layer.
--
-- Background:
--   20260520 added a skip list (offline / easebuzz / icici).
--   20260604 recreated fn_notify_* without that skip list, so gateway
--   inserts double-fired: trigger + edge-function notify.
--   Payment links use gateway='razorpay' and also call notify-event from
--   pay-link / payment-link-reconcile-cron, which produced two identical
--   WhatsApp receipt messages for the same receipt_no (e.g. N298).
--
-- Policy: if gateway is set to a known app-notified value, the trigger is
-- silent. NULL / unknown gateways still notify so manual SQL / legacy
-- rows are not muted forever.

CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  -- App layer owns these: OfflinePaymentDialog, easebuzz/icici/razorpay callbacks,
  -- pay-link, payment-link-reconcile-cron, RecordPaymentDialog.
  IF COALESCE(NEW.gateway, '') IN ('offline', 'easebuzz', 'icici', 'razorpay', 'cashfree') THEN
    RETURN NEW;
  END IF;

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
  IF COALESCE(NEW.gateway, '') IN ('offline', 'easebuzz', 'icici', 'razorpay', 'cashfree') THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_notify_payment_received() IS
  'Fires payment_received notify-event for confirmed non-app-fee lead_payments. Skips offline/easebuzz/icici/razorpay/cashfree — those notify from edge functions / UI.';

COMMENT ON FUNCTION public.fn_notify_app_fee_paid() IS
  'Fires app_fee_paid notify-event for confirmed application_fee rows. Skips known gateways that notify from the application layer.';
