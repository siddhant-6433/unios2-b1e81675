-- All payment paths now invoke notify-event from the application layer
-- (offline dialog, RecordPaymentDialog, easebuzz callback, icici callback +
-- reconcile cron). The DB trigger therefore needs to skip ALL of those
-- gateways to prevent duplicate notifications. Unknown / NULL gateways
-- (legacy rows, manual SQL inserts) still fall through to the trigger so
-- nothing goes completely silent.

CREATE OR REPLACE FUNCTION public.fn_notify_app_fee_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.type <> 'application_fee' OR NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'confirmed' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway, '') IN ('offline','easebuzz','icici') THEN RETURN NEW; END IF;

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
  IF COALESCE(NEW.gateway, '') IN ('offline','easebuzz','icici') THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'payment_received',
    NEW.lead_id,
    jsonb_build_object('payment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

------------------------------------------------------------------------
-- Manual notification re-trigger for super-admins.
--   - "resend"     → re-fire the payment receipt for an old row
--   - "correction" → re-fire after an edit, clears receipt_url so PDF
--                    regenerates with the new figures
-- Implemented via fn_notify_event() which posts to notify-event.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_payment_notification(
  _payment_id uuid,
  _mode       text DEFAULT 'resend'   -- 'resend' | 'correction'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_type    text;
  v_event   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  SELECT lead_id, type INTO v_lead_id, v_type
    FROM public.lead_payments
   WHERE id = _payment_id;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', _payment_id;
  END IF;

  IF _mode = 'correction' THEN
    v_event := 'payment_corrected';
  ELSIF v_type = 'application_fee' THEN
    v_event := 'app_fee_paid';
  ELSE
    v_event := 'payment_received';
  END IF;

  PERFORM public.fn_notify_event(
    v_event,
    v_lead_id,
    jsonb_build_object('payment_id', _payment_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resend_payment_notification(uuid, text) TO authenticated;
