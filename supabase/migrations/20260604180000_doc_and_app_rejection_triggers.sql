-- Triggers for the two rejection lifecycle events:
--   - application_doc_reviews: status flips to 'rejected' → notify student
--   - applications: status flips to 'rejected' → notify student
--
-- Both fire fn_notify_event() which POSTs to notify-event edge function.

------------------------------------------------------------------------
-- Doc rejected
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notify_doc_rejected()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  -- Only fire on transitions INTO rejected — not subsequent edits.
  IF NEW.status <> 'rejected' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'rejected' THEN RETURN NEW; END IF;

  -- Resolve lead via application_id
  SELECT lead_id INTO v_lead_id
  FROM public.applications
  WHERE application_id = NEW.application_id
  LIMIT 1;
  IF v_lead_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'doc_rejected',
    v_lead_id,
    jsonb_build_object(
      'file_path', NEW.file_path,
      'reason',    COALESCE(NEW.notes, '')
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_doc_rejected ON public.application_doc_reviews;
CREATE TRIGGER trg_notify_doc_rejected
  AFTER INSERT OR UPDATE OF status ON public.application_doc_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_doc_rejected();

------------------------------------------------------------------------
-- Application rejected
------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_notify_application_rejected()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'rejected' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'rejected' THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.fn_notify_event(
    'application_rejected',
    NEW.lead_id,
    jsonb_build_object(
      'application_id', NEW.application_id,
      'reason',         COALESCE(NEW.rejection_reason, '')
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_application_rejected ON public.applications;
CREATE TRIGGER trg_notify_application_rejected
  AFTER UPDATE OF status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_application_rejected();
