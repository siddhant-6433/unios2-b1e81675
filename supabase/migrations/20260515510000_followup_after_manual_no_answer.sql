-- Auto-create a pending follow-up whenever a MANUAL call ends without contact
-- (busy / no_answer / failed / voicemail). The trigger is idempotent: if any
-- pending follow-up already exists for the lead, nothing is inserted, so it
-- is safe alongside the CloudDialer client-side insert.

CREATE OR REPLACE FUNCTION public.ensure_followup_for_manual_no_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_count int;
  v_lead_stage text;
BEGIN
  IF NEW.call_type IS DISTINCT FROM 'manual' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('busy','no_answer','failed','voicemail') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip leads in terminal / opted-out stages
  SELECT stage INTO v_lead_stage FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead_stage IN ('not_interested','dnc','rejected','ineligible') THEN
    RETURN NEW;
  END IF;

  -- Skip if any pending follow-up already exists
  SELECT count(*) INTO v_pending_count
    FROM public.lead_followups
    WHERE lead_id = NEW.lead_id AND status = 'pending';
  IF v_pending_count > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.lead_followups (lead_id, scheduled_at, type, status, notes)
  VALUES (
    NEW.lead_id,
    NOW() + INTERVAL '4 hours',
    'call',
    'pending',
    'Auto: manual call ' || NEW.status || ' — retry'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_for_manual_no_answer ON public.ai_call_records;
CREATE TRIGGER trg_followup_for_manual_no_answer
AFTER INSERT OR UPDATE OF status ON public.ai_call_records
FOR EACH ROW EXECUTE FUNCTION public.ensure_followup_for_manual_no_answer();

-- One-time backfill: every lead that has at least one manual no-contact call
-- but no pending follow-up gets a single retry follow-up scheduled an hour out.
INSERT INTO public.lead_followups (lead_id, scheduled_at, type, status, notes)
SELECT DISTINCT ON (acr.lead_id)
  acr.lead_id,
  NOW() + INTERVAL '1 hour',
  'call',
  'pending',
  'Auto-backfill: manual call ' || acr.status || ' — retry'
FROM public.ai_call_records acr
JOIN public.leads l ON l.id = acr.lead_id
WHERE acr.call_type = 'manual'
  AND acr.status IN ('busy','no_answer','failed','voicemail')
  AND (l.stage IS NULL OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible'))
  AND NOT EXISTS (
    SELECT 1 FROM public.lead_followups lf
    WHERE lf.lead_id = acr.lead_id AND lf.status = 'pending'
  )
ORDER BY acr.lead_id, acr.created_at DESC;
