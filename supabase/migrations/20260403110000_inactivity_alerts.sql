-- Sprint 2 Feature 2: Inactivity Alerts + Overdue Follow-ups

-- Stage-based inactivity thresholds (admin-configurable)
CREATE TABLE public.stage_inactivity_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL UNIQUE,
  max_inactive_days integer NOT NULL DEFAULT 3,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.stage_inactivity_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage inactivity thresholds"
  ON public.stage_inactivity_thresholds FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Pre-seed with sensible defaults
INSERT INTO public.stage_inactivity_thresholds (stage, max_inactive_days) VALUES
  ('new_lead', 2),
  ('application_in_progress', 3),
  ('application_fee_paid', 5),
  ('application_submitted', 3),
  ('ai_called', 2),
  ('counsellor_call', 3),
  ('visit_scheduled', 5),
  ('interview', 3),
  ('offer_sent', 7),
  ('token_paid', 5),
  ('pre_admitted', 7)
ON CONFLICT (stage) DO NOTHING;

-- View: inactive leads exceeding their stage threshold
CREATE OR REPLACE VIEW public.inactive_leads AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.stage,
  l.counsellor_id,
  l.course_id,
  l.campus_id,
  l.updated_at,
  EXTRACT(DAY FROM now() - l.updated_at)::integer AS days_inactive,
  sit.max_inactive_days
FROM public.leads l
JOIN public.stage_inactivity_thresholds sit ON sit.stage = l.stage::text
WHERE l.stage NOT IN ('admitted', 'rejected')
  AND EXTRACT(DAY FROM now() - l.updated_at)::integer > sit.max_inactive_days;

GRANT SELECT ON public.inactive_leads TO authenticated;

-- View: overdue follow-ups
CREATE OR REPLACE VIEW public.overdue_followups AS
SELECT
  lf.id,
  lf.lead_id,
  lf.user_id AS counsellor_user_id,
  lf.scheduled_at,
  lf.type,
  lf.notes,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.stage AS lead_stage,
  l.counsellor_id,
  EXTRACT(DAY FROM now() - lf.scheduled_at)::integer AS days_overdue
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE lf.status = 'pending'
  AND lf.scheduled_at < now()
ORDER BY lf.scheduled_at ASC;

GRANT SELECT ON public.overdue_followups TO authenticated;
