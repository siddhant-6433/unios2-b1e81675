-- Add priority_interested to lead_stage enum
ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'priority_interested';

-- Auto-elevate lead to priority_interested when AI call completes with >= 60% conversion
CREATE OR REPLACE FUNCTION public.fn_auto_elevate_priority_interested()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_stage text;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF NEW.conversion_probability IS NULL OR NEW.conversion_probability < 60 THEN RETURN NEW; END IF;
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT stage::text INTO v_stage FROM public.leads WHERE id = NEW.lead_id;

  -- Only elevate early-funnel leads; don't touch leads already in application flow
  IF v_stage IN ('new_lead', 'counsellor_call') THEN
    UPDATE public.leads SET stage = 'priority_interested' WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_elevate_priority_interested ON public.ai_call_records;
CREATE TRIGGER trg_auto_elevate_priority_interested
  AFTER INSERT OR UPDATE OF status, conversion_probability ON public.ai_call_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_elevate_priority_interested();
