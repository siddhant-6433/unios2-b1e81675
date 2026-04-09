-- Lead Velocity SLA + Notification System + Visit/Followup Enforcement
-- =====================================================================

-- 1. SLA configuration per stage (first contact deadline)
CREATE TABLE public.stage_sla_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL UNIQUE,
  first_contact_hours integer NOT NULL DEFAULT 4,
  warning_hours integer NOT NULL DEFAULT 3,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.stage_sla_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage SLA config"
  ON public.stage_sla_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.stage_sla_config (stage, first_contact_hours, warning_hours) VALUES
  ('new_lead', 4, 3),
  ('application_in_progress', 8, 6),
  ('application_fee_paid', 12, 10),
  ('application_submitted', 8, 6),
  ('ai_called', 4, 3),
  ('counsellor_call', 6, 4),
  ('visit_scheduled', 8, 6),
  ('interview', 6, 4),
  ('offer_sent', 24, 20),
  ('token_paid', 12, 10),
  ('pre_admitted', 24, 20)
ON CONFLICT (stage) DO NOTHING;

-- 2. New columns on leads for SLA tracking
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_returned_count integer NOT NULL DEFAULT 0;

-- 3. Trigger: auto-set assigned_at when counsellor changes, reset first_contact_at
CREATE OR REPLACE FUNCTION fn_lead_assignment_tracker()
RETURNS TRIGGER AS $$
BEGIN
  -- counsellor_id changed from NULL to non-null, or changed to a different counsellor
  IF (OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id) AND NEW.counsellor_id IS NOT NULL THEN
    NEW.assigned_at := now();
    NEW.first_contact_at := NULL;
  END IF;
  -- counsellor removed (back to bucket)
  IF NEW.counsellor_id IS NULL AND OLD.counsellor_id IS NOT NULL THEN
    NEW.assigned_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_assignment_tracker ON public.leads;
CREATE TRIGGER trg_lead_assignment_tracker
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_lead_assignment_tracker();

-- 4. Auto-set first_contact_at when a call/whatsapp activity is logged
CREATE OR REPLACE FUNCTION fn_auto_first_contact()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type IN ('call', 'whatsapp') THEN
    UPDATE public.leads
    SET first_contact_at = now()
    WHERE id = NEW.lead_id
      AND first_contact_at IS NULL
      AND counsellor_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_first_contact ON public.lead_activities;
CREATE TRIGGER trg_auto_first_contact
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_first_contact();

-- 5. Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'lead_assigned', 'sla_warning', 'lead_reclaimed',
    'followup_due', 'followup_overdue', 'visit_confirmation_due',
    'visit_followup_due', 'lead_transferred', 'deletion_request', 'general'
  )),
  title text NOT NULL,
  body text,
  link text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

-- 6. Trigger: generate in-app notification when counsellor_id is assigned
CREATE OR REPLACE FUNCTION fn_notify_lead_assigned()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id) AND NEW.counsellor_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    VALUES (
      NEW.counsellor_id,
      'lead_assigned',
      'New lead assigned: ' || NEW.name,
      'Make first contact within the SLA window.',
      '/admissions/' || NEW.id,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_lead_assigned ON public.leads;
CREATE TRIGGER trg_notify_lead_assigned
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_lead_assigned();

-- 7. Views for the cron to query

-- Leads that breached SLA (no first contact within deadline)
CREATE OR REPLACE VIEW public.sla_breached_leads AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.stage,
  l.counsellor_id,
  l.assigned_at,
  l.campus_id,
  l.course_id,
  sc.first_contact_hours,
  EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 AS hours_since_assigned
FROM public.leads l
JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
WHERE l.counsellor_id IS NOT NULL
  AND l.first_contact_at IS NULL
  AND l.assigned_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours
  AND l.stage NOT IN ('admitted', 'rejected');

GRANT SELECT ON public.sla_breached_leads TO authenticated;

-- Leads approaching SLA (past warning, not yet breached)
CREATE OR REPLACE VIEW public.sla_warning_leads AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.stage,
  l.counsellor_id,
  l.assigned_at,
  l.campus_id,
  l.course_id,
  sc.first_contact_hours,
  sc.warning_hours,
  EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 AS hours_since_assigned,
  sc.first_contact_hours - EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 AS hours_remaining
FROM public.leads l
JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
WHERE l.counsellor_id IS NOT NULL
  AND l.first_contact_at IS NULL
  AND l.assigned_at IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 >= sc.warning_hours
  AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 <= sc.first_contact_hours
  AND l.stage NOT IN ('admitted', 'rejected');

GRANT SELECT ON public.sla_warning_leads TO authenticated;

-- Visits needing confirmation calls (scheduled for tomorrow or today, not yet confirmed)
CREATE OR REPLACE VIEW public.visits_needing_confirmation AS
SELECT
  cv.id AS visit_id,
  cv.lead_id,
  cv.campus_id,
  cv.visit_date,
  cv.status,
  cv.scheduled_by,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.counsellor_id,
  cam.name AS campus_name,
  CASE
    WHEN cv.visit_date::date = CURRENT_DATE THEN 'same_day'
    WHEN cv.visit_date::date = CURRENT_DATE + 1 THEN 'day_before'
    ELSE 'future'
  END AS urgency
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
WHERE cv.status IN ('scheduled')
  AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1;

GRANT SELECT ON public.visits_needing_confirmation TO authenticated;

-- Completed visits needing follow-up (visited but no followup scheduled within 2 days)
CREATE OR REPLACE VIEW public.visits_needing_followup AS
SELECT
  cv.id AS visit_id,
  cv.lead_id,
  cv.campus_id,
  cv.visit_date,
  cv.scheduled_by,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.counsellor_id,
  l.stage,
  cam.name AS campus_name,
  EXTRACT(DAY FROM now() - cv.visit_date)::integer AS days_since_visit
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
WHERE cv.status = 'completed'
  AND l.stage NOT IN ('admitted', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM public.lead_followups lf
    WHERE lf.lead_id = cv.lead_id
      AND lf.created_at > cv.visit_date
      AND lf.status IN ('pending', 'completed')
  )
  AND EXTRACT(DAY FROM now() - cv.visit_date) <= 7;

GRANT SELECT ON public.visits_needing_followup TO authenticated;

-- 8. Followup SLA: overdue followups that should trigger notification + auto-return
-- (reuses the existing overdue_followups view, extended)
CREATE OR REPLACE VIEW public.followup_sla_breached AS
SELECT
  lf.id AS followup_id,
  lf.lead_id,
  lf.user_id AS counsellor_user_id,
  lf.scheduled_at,
  lf.type,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.counsellor_id,
  l.stage AS lead_stage,
  EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 3600 AS hours_overdue
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE lf.status = 'pending'
  AND lf.scheduled_at < now()
  AND EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 3600 > 48
  AND l.stage NOT IN ('admitted', 'rejected');

GRANT SELECT ON public.followup_sla_breached TO authenticated;

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
