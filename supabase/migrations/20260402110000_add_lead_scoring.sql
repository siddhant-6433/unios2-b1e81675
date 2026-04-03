-- Feature 2: Lead Scoring + Hot/Warm/Cold Temperature

-- 1. Add columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_temperature text DEFAULT 'cold'
    CHECK (lead_temperature IN ('hot', 'warm', 'cold'));

-- 2. Score computation function
CREATE OR REPLACE FUNCTION public.compute_lead_score(p_lead_id uuid)
RETURNS integer AS $$
DECLARE
  v_score integer := 0;
  v_lead record;
  v_activity_count integer;
  v_days_stale integer;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Stage-based points
  v_score := v_score + CASE v_lead.stage
    WHEN 'new_lead'                THEN 0
    WHEN 'application_in_progress' THEN 10
    WHEN 'application_fee_paid'    THEN 20
    WHEN 'application_submitted'   THEN 25
    WHEN 'ai_called'               THEN 15
    WHEN 'counsellor_call'         THEN 20
    WHEN 'visit_scheduled'         THEN 30
    WHEN 'interview'               THEN 40
    WHEN 'offer_sent'              THEN 50
    WHEN 'token_paid'              THEN 70
    WHEN 'pre_admitted'            THEN 85
    WHEN 'admitted'                THEN 100
    WHEN 'rejected'                THEN 0
    ELSE 0
  END;

  -- Source quality bonus
  v_score := v_score + CASE v_lead.source
    WHEN 'walk_in'  THEN 15
    WHEN 'referral' THEN 10
    WHEN 'website'  THEN 5
    ELSE 0
  END;

  -- Interview score bonus
  IF v_lead.interview_score IS NOT NULL THEN
    v_score := v_score + LEAST(v_lead.interview_score / 2, 15);
  END IF;

  -- Engagement: activity count
  SELECT COUNT(*) INTO v_activity_count
  FROM public.lead_activities WHERE lead_id = p_lead_id;
  v_score := v_score + LEAST(v_activity_count * 2, 20);

  -- Staleness penalty
  v_days_stale := EXTRACT(DAY FROM now() - v_lead.updated_at)::integer;
  IF v_days_stale > 30 THEN v_score := v_score - 15; END IF;
  IF v_days_stale > 60 THEN v_score := v_score - 15; END IF;

  RETURN GREATEST(v_score, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. Temperature from score
CREATE OR REPLACE FUNCTION public.compute_lead_temperature(p_score integer)
RETURNS text AS $$
BEGIN
  IF p_score >= 60 THEN RETURN 'hot';
  ELSIF p_score >= 30 THEN RETURN 'warm';
  ELSE RETURN 'cold';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Backfill existing leads
UPDATE public.leads SET
  lead_score = public.compute_lead_score(id),
  lead_temperature = public.compute_lead_temperature(public.compute_lead_score(id));

-- 5. Trigger to keep scores fresh on lead updates
CREATE OR REPLACE FUNCTION public.trigger_update_lead_score()
RETURNS trigger AS $$
BEGIN
  NEW.lead_score := public.compute_lead_score(NEW.id);
  NEW.lead_temperature := public.compute_lead_temperature(NEW.lead_score);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_score_update ON public.leads;
CREATE TRIGGER trg_lead_score_update
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_update_lead_score();
