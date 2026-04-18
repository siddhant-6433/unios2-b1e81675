-- Phase 3: WhatsApp Feedback System + Automation Rule Fixes

-- 1. Feedback responses table
CREATE TABLE public.feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('call', 'visit')),
  interaction_id uuid, -- FK to call_logs.id or campus_visits.id
  rating integer CHECK (rating >= 1 AND rating <= 5),
  feedback_text text,
  wa_message_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'responded', 'expired')),
  sent_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_feedback_lead ON public.feedback_responses(lead_id);
CREATE INDEX idx_feedback_counsellor ON public.feedback_responses(counsellor_id, created_at DESC);
CREATE INDEX idx_feedback_status ON public.feedback_responses(status) WHERE status = 'sent';

ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read feedback" ON public.feedback_responses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can manage feedback" ON public.feedback_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Feedback score integration trigger
-- When a feedback response is rated, insert a score event
CREATE OR REPLACE FUNCTION public.fn_score_feedback_response()
RETURNS trigger AS $$
DECLARE
  v_points integer;
BEGIN
  IF NEW.rating IS NOT NULL AND (OLD.rating IS NULL OR OLD.rating IS DISTINCT FROM NEW.rating) THEN
    v_points := CASE
      WHEN NEW.rating = 5 THEN 3
      WHEN NEW.rating = 4 THEN 2
      WHEN NEW.rating = 3 THEN 0
      WHEN NEW.rating = 2 THEN -1
      WHEN NEW.rating = 1 THEN -2
      ELSE 0
    END;

    IF v_points != 0 THEN
      INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
      VALUES (
        NEW.counsellor_id,
        NEW.lead_id,
        'student_feedback',
        v_points,
        jsonb_build_object('rating', NEW.rating, 'interaction_type', NEW.interaction_type)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_score_feedback
  AFTER UPDATE ON public.feedback_responses
  FOR EACH ROW EXECUTE FUNCTION public.fn_score_feedback_response();

-- 3. Feedback sampling trigger on call_logs (1:10 sample on positive dispositions)
CREATE OR REPLACE FUNCTION public.fn_sample_feedback_call()
RETURNS trigger AS $$
DECLARE
  v_counsellor_id uuid;
  v_supabase_url text;
  v_service_key text;
BEGIN
  -- Only sample positive dispositions
  IF NEW.disposition NOT IN ('interested', 'call_back') THEN
    RETURN NEW;
  END IF;

  -- 10% random sample
  IF random() >= 0.10 THEN
    RETURN NEW;
  END IF;

  -- Get counsellor
  SELECT counsellor_id INTO v_counsellor_id FROM public.leads WHERE id = NEW.lead_id;
  IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

  -- Insert feedback request (will be sent by the webhook/cron)
  INSERT INTO public.feedback_responses (lead_id, counsellor_id, interaction_type, interaction_id, status)
  VALUES (NEW.lead_id, v_counsellor_id, 'call', NEW.id, 'pending_send');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- Don't block the insert
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_feedback_sample_call
  AFTER INSERT ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_sample_feedback_call();

-- 4. Feedback sampling trigger on campus_visits (1:10 sample on completion)
CREATE OR REPLACE FUNCTION public.fn_sample_feedback_visit()
RETURNS trigger AS $$
DECLARE
  v_counsellor_id uuid;
BEGIN
  -- Only on completion
  IF NOT (OLD.status != 'completed' AND NEW.status = 'completed') THEN
    RETURN NEW;
  END IF;

  -- 10% random sample
  IF random() >= 0.10 THEN
    RETURN NEW;
  END IF;

  -- Get counsellor
  SELECT counsellor_id INTO v_counsellor_id FROM public.leads WHERE id = NEW.lead_id;
  IF v_counsellor_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.feedback_responses (lead_id, counsellor_id, interaction_type, interaction_id, status)
  VALUES (NEW.lead_id, v_counsellor_id, 'visit', NEW.id, 'pending_send');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_feedback_sample_visit
  AFTER UPDATE ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_sample_feedback_visit();

-- Update feedback status check to include pending_send
ALTER TABLE public.feedback_responses DROP CONSTRAINT IF EXISTS feedback_responses_status_check;
ALTER TABLE public.feedback_responses ADD CONSTRAINT feedback_responses_status_check
  CHECK (status IN ('pending_send', 'sent', 'responded', 'expired'));

-- 5. Counsellor feedback summary view
CREATE OR REPLACE VIEW public.counsellor_feedback_summary AS
SELECT
  fr.counsellor_id,
  p.display_name AS counsellor_name,
  COUNT(*) FILTER (WHERE fr.status = 'responded') AS total_responses,
  ROUND(AVG(fr.rating) FILTER (WHERE fr.status = 'responded'), 1) AS avg_rating,
  COUNT(*) FILTER (WHERE fr.rating = 5) AS five_star,
  COUNT(*) FILTER (WHERE fr.rating = 4) AS four_star,
  COUNT(*) FILTER (WHERE fr.rating <= 2) AS low_rating,
  COUNT(*) FILTER (WHERE fr.status = 'sent') AS pending
FROM public.feedback_responses fr
JOIN public.profiles p ON p.id = fr.counsellor_id
GROUP BY fr.counsellor_id, p.display_name;

GRANT SELECT ON public.counsellor_feedback_summary TO authenticated;

-- 6. Fix automation rules

-- 6a. Delete the DUPLICATE "Visit Attended → Schedule Follow-up Call" (pre-seeded inactive rule that was activated)
-- Keep the "Visit Scheduled → 24hr Follow-up" rule from the newer migration
DELETE FROM public.automation_rules
WHERE name = 'Visit Attended → Schedule Follow-up Call';

-- 6b. Fix "Visit Scheduled → WhatsApp Confirmation" — hardcoded date string
UPDATE public.automation_rules
SET actions = '[{"type": "send_whatsapp", "template_key": "visit_confirmation", "params_template": ["{{name}}", "{{visit_date}}", "{{campus}}"]}]'
WHERE name = 'Visit Scheduled → WhatsApp Confirmation';

-- 6c. Fix "Lead Assigned → WhatsApp to Counsellor" — actually send WhatsApp, not just notification
UPDATE public.automation_rules
SET actions = '[{"type": "create_notification", "notify_counsellor": true, "notification_type": "lead_assigned", "title": "New lead assigned: {{name}}", "body": "Make first contact within the SLA window."}, {"type": "send_whatsapp", "template_key": "counsellor_lead_assigned", "send_to_counsellor": true, "params_template": ["{{counsellor_name}}", "{{name}}", "{{phone_last4}}", "4"]}]'
WHERE name = 'Lead Assigned → WhatsApp to Counsellor';

-- 7. Schedule feedback sender cron (every 30min to send pending_send feedback requests)
SELECT cron.schedule(
  'feedback-sender',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/feedback-sender-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
