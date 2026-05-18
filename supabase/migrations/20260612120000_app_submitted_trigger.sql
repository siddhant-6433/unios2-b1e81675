-- Fire 'app_submitted' lifecycle notification via DB trigger instead of
-- from the apply portal client.
--
-- BUG: ApplyPortal.tsx invoked supabase.functions.invoke("notify-event")
-- from anonymous (apply portal) context with a 4s setTimeout. notify-event
-- requires a service-role token internally (rejects anon callers with 401),
-- so the call ALWAYS silently failed — counsellor / TL / super-admin never
-- got the "new application received" WhatsApp / email.
--
-- FIX: same pattern as the other 4 lifecycle events (app_fee_paid,
-- offer_issued, payment_received, pan_issued) — fire from an AFTER trigger
-- via public.fn_notify_event(), which already POSTs to notify-event with
-- the service-role key in the Authorization header (pg_net).
--
-- Comment block C / D in 20260604160000_lifecycle_notifications.sql noted
-- that app_submitted was "fired from ApplyPortal.tsx after handleSubmit
-- completes — no DB trigger needed". That premise was wrong: the client
-- can't authenticate as service_role, so the notification never landed.
--
-- The companion client change removes the failing supabase.functions.invoke
-- in ApplyPortal.tsx so we don't leave a dead call in production.

CREATE OR REPLACE FUNCTION public.fn_notify_app_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'submitted' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'submitted' THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'app_submitted',
    NEW.lead_id,
    jsonb_build_object('application_id', NEW.application_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_app_submitted ON public.applications;
CREATE TRIGGER trg_notify_app_submitted
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_app_submitted();
