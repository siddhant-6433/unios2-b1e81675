-- Phase 1: Counsellor Gamification Scoring System

-- 1. Score events ledger (event-sourced)
CREATE TABLE public.counsellor_score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  points integer NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_score_events_counsellor_date ON public.counsellor_score_events(counsellor_id, created_at DESC);
CREATE INDEX idx_score_events_lead ON public.counsellor_score_events(lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE public.counsellor_score_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read score events" ON public.counsellor_score_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can insert score events" ON public.counsellor_score_events
  FOR INSERT TO authenticated WITH CHECK (true);

-- 2. Add visit_type to campus_visits
ALTER TABLE public.campus_visits ADD COLUMN IF NOT EXISTS visit_type text DEFAULT 'scheduled';
-- Note: no_show can be added as a status value; the status column is text so no enum change needed

-- 3. Leaderboard view
CREATE OR REPLACE VIEW public.counsellor_leaderboard AS
SELECT
  p.id AS counsellor_id,
  p.display_name AS counsellor_name,
  p.user_id,
  COALESCE(SUM(cse.points), 0)::integer AS total_score,
  COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= date_trunc('week', now())), 0)::integer AS weekly_score,
  COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= date_trunc('month', now())), 0)::integer AS monthly_score,
  COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= now() - interval '1 day'), 0)::integer AS daily_score,
  COUNT(*) FILTER (WHERE cse.points > 0)::integer AS positive_actions,
  COUNT(*) FILTER (WHERE cse.points < 0)::integer AS negative_actions
FROM public.profiles p
INNER JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role IN ('counsellor', 'admission_head')
LEFT JOIN public.counsellor_score_events cse ON cse.counsellor_id = p.id
GROUP BY p.id, p.display_name, p.user_id;

GRANT SELECT ON public.counsellor_leaderboard TO authenticated;

-- 4. Trigger function: auto-record score events on key actions
CREATE OR REPLACE FUNCTION public.fn_record_counsellor_score()
RETURNS trigger AS $$
DECLARE
  v_counsellor_id uuid;
  v_lead_id uuid;
  v_action text;
  v_points integer;
  v_meta jsonb;
BEGIN
  -- Determine context based on which table fired the trigger
  IF TG_TABLE_NAME = 'call_logs' AND TG_OP = 'INSERT' THEN
    -- Get counsellor from lead
    SELECT l.counsellor_id, NEW.lead_id INTO v_counsellor_id, v_lead_id
    FROM public.leads l WHERE l.id = NEW.lead_id;

    IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

    -- Check if this is first contact
    IF EXISTS (
      SELECT 1 FROM public.leads WHERE id = NEW.lead_id AND first_contact_at IS NULL
    ) THEN
      INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
      VALUES (v_counsellor_id, v_lead_id, 'first_contact', 5, jsonb_build_object('disposition', NEW.disposition));
    END IF;

    -- Score based on disposition
    v_points := CASE NEW.disposition
      WHEN 'interested' THEN 10
      WHEN 'call_back' THEN 3
      WHEN 'not_answered' THEN 1
      WHEN 'busy' THEN 1
      WHEN 'voicemail' THEN 1
      WHEN 'not_interested' THEN -3
      WHEN 'do_not_contact' THEN -2
      WHEN 'wrong_number' THEN -2
      ELSE 0
    END;

    IF v_points != 0 THEN
      INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
      VALUES (v_counsellor_id, v_lead_id, 'call_disposition', v_points,
        jsonb_build_object('disposition', NEW.disposition, 'duration', NEW.duration_seconds));
    END IF;

  ELSIF TG_TABLE_NAME = 'leads' AND TG_OP = 'UPDATE' THEN
    v_counsellor_id := NEW.counsellor_id;
    v_lead_id := NEW.id;

    IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

    -- Score stage advancements
    IF OLD.stage IS DISTINCT FROM NEW.stage THEN
      v_points := CASE NEW.stage::text
        WHEN 'application_in_progress' THEN 10
        WHEN 'offer_sent' THEN 10
        WHEN 'token_paid' THEN 20
        WHEN 'admitted' THEN 50
        WHEN 'rejected' THEN -3
        WHEN 'not_interested' THEN -3
        ELSE 0
      END;

      IF v_points != 0 THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'stage_change', v_points,
          jsonb_build_object('from_stage', OLD.stage::text, 'to_stage', NEW.stage::text));
      END IF;
    END IF;

    -- SLA: first contact within threshold
    IF OLD.first_contact_at IS NULL AND NEW.first_contact_at IS NOT NULL AND NEW.assigned_at IS NOT NULL THEN
      IF EXTRACT(EPOCH FROM (NEW.first_contact_at - NEW.assigned_at)) / 3600 <= 4 THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'sla_met', 10,
          jsonb_build_object('hours', ROUND(EXTRACT(EPOCH FROM (NEW.first_contact_at - NEW.assigned_at)) / 3600, 1)));
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'campus_visits' THEN
    SELECT l.counsellor_id INTO v_counsellor_id FROM public.leads l WHERE l.id = NEW.lead_id;
    v_lead_id := NEW.lead_id;

    IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'INSERT' THEN
      -- Visit scheduled or walk-in recorded
      IF COALESCE(NEW.visit_type, 'scheduled') = 'walk_in' THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'walk_in_recorded', 20, jsonb_build_object('campus_id', NEW.campus_id));
      ELSE
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'visit_scheduled', 8, jsonb_build_object('campus_id', NEW.campus_id));
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      -- Visit completed
      IF OLD.status != 'completed' AND NEW.status = 'completed' AND COALESCE(NEW.visit_type, 'scheduled') != 'walk_in' THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'visit_completed', 15, jsonb_build_object('visit_id', NEW.id));
      END IF;

      -- Visit confirmed
      IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'visit_confirmed', 3, jsonb_build_object('visit_id', NEW.id));
      END IF;

      -- Visit no-show
      IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'visit_no_show', -5, jsonb_build_object('visit_id', NEW.id));
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'lead_followups' AND TG_OP = 'UPDATE' THEN
    SELECT l.counsellor_id INTO v_counsellor_id FROM public.leads l WHERE l.id = NEW.lead_id;
    v_lead_id := NEW.lead_id;

    IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

    -- Follow-up completed
    IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
      -- Check if on time (within 24h of scheduled)
      IF NEW.completed_at <= NEW.scheduled_at + interval '24 hours' THEN
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'followup_on_time', 5,
          jsonb_build_object('type', NEW.type, 'scheduled_at', NEW.scheduled_at));
      ELSE
        -- Late but still completed
        INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
        VALUES (v_counsellor_id, v_lead_id, 'followup_late', 2,
          jsonb_build_object('type', NEW.type, 'hours_late',
            ROUND(EXTRACT(EPOCH FROM (NEW.completed_at - NEW.scheduled_at)) / 3600, 1)));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach triggers
CREATE TRIGGER trg_score_call_logs
  AFTER INSERT ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_record_counsellor_score();

CREATE TRIGGER trg_score_leads
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_record_counsellor_score();

CREATE TRIGGER trg_score_campus_visits
  AFTER INSERT OR UPDATE ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_record_counsellor_score();

CREATE TRIGGER trg_score_followups
  AFTER UPDATE ON public.lead_followups
  FOR EACH ROW EXECUTE FUNCTION public.fn_record_counsellor_score();
