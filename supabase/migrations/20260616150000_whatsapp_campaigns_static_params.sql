-- Static per-template params filled once at campaign creation. The
-- whatsapp-campaign-send function uses these to fill template slots that
-- aren't per-lead (e.g. visit_date, fee amount, due date). Auto-filled per
-- lead from a leads → courses → campuses join: student_name, course_name,
-- campus_name.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS static_params jsonb DEFAULT '{}'::jsonb;
