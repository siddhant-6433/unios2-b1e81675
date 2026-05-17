-- Feedback sampling: 3-day cooldown per lead.
--
-- Don't ask the same lead for feedback more than once every 3 days, even if
-- the 10% sampling lottery picks them again. Applies to both call and visit
-- sampling triggers.

CREATE OR REPLACE FUNCTION public.fn_sample_feedback_call()
RETURNS trigger AS $$
DECLARE
  v_counsellor_id uuid;
  v_recent_count  integer;
BEGIN
  IF NEW.disposition NOT IN ('interested', 'call_back') THEN
    RETURN NEW;
  END IF;

  IF random() >= 0.10 THEN
    RETURN NEW;
  END IF;

  SELECT counsellor_id INTO v_counsellor_id FROM public.leads WHERE id = NEW.lead_id;
  IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

  -- 3-day cooldown: skip if this lead already got a feedback request recently
  SELECT count(*) INTO v_recent_count
  FROM public.feedback_responses
  WHERE lead_id = NEW.lead_id
    AND created_at >= now() - interval '3 days';
  IF v_recent_count > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.feedback_responses (lead_id, counsellor_id, interaction_type, interaction_id, status)
  VALUES (NEW.lead_id, v_counsellor_id, 'call', NEW.id, 'pending_send');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_sample_feedback_visit()
RETURNS trigger AS $$
DECLARE
  v_counsellor_id uuid;
  v_recent_count  integer;
BEGIN
  IF NOT (OLD.status != 'completed' AND NEW.status = 'completed') THEN
    RETURN NEW;
  END IF;

  IF random() >= 0.10 THEN
    RETURN NEW;
  END IF;

  SELECT counsellor_id INTO v_counsellor_id FROM public.leads WHERE id = NEW.lead_id;
  IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.feedback_responses
  WHERE lead_id = NEW.lead_id
    AND created_at >= now() - interval '3 days';
  IF v_recent_count > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.feedback_responses (lead_id, counsellor_id, interaction_type, interaction_id, status)
  VALUES (NEW.lead_id, v_counsellor_id, 'visit', NEW.id, 'pending_send');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Supporting index for the cooldown lookup
CREATE INDEX IF NOT EXISTS idx_feedback_lead_created
  ON public.feedback_responses(lead_id, created_at DESC);
