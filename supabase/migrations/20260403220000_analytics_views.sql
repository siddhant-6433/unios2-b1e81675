-- Sprint 3 Feature 3: Analytics Dashboard Views

-- Stage aging summary
CREATE OR REPLACE VIEW public.stage_aging_summary AS
SELECT
  l.stage::text,
  COUNT(*) AS lead_count,
  ROUND(AVG(EXTRACT(DAY FROM now() - l.updated_at))::numeric, 1) AS avg_days_in_stage,
  MAX(EXTRACT(DAY FROM now() - l.updated_at))::integer AS max_days_in_stage,
  COUNT(*) FILTER (WHERE EXTRACT(DAY FROM now() - l.updated_at) > 7) AS stale_count
FROM public.leads l
WHERE l.stage NOT IN ('admitted', 'rejected')
GROUP BY l.stage;

GRANT SELECT ON public.stage_aging_summary TO authenticated;

-- Daily admission trend (last 90 days)
CREATE OR REPLACE VIEW public.daily_admission_trend AS
SELECT
  date_trunc('day', la.created_at)::date AS day,
  COUNT(*) FILTER (WHERE la.new_stage::text = 'admitted') AS admissions,
  COUNT(*) FILTER (WHERE la.type = 'lead_created') AS new_leads
FROM public.lead_activities la
WHERE la.created_at >= now() - interval '90 days'
GROUP BY date_trunc('day', la.created_at)
ORDER BY day;

GRANT SELECT ON public.daily_admission_trend TO authenticated;

-- Hourly activity heatmap (last 30 days, IST timezone)
CREATE OR REPLACE VIEW public.hourly_activity_heatmap AS
SELECT
  EXTRACT(DOW FROM la.created_at AT TIME ZONE 'Asia/Kolkata')::integer AS day_of_week,
  EXTRACT(HOUR FROM la.created_at AT TIME ZONE 'Asia/Kolkata')::integer AS hour,
  COUNT(*) AS activity_count
FROM public.lead_activities la
WHERE la.created_at >= now() - interval '30 days'
GROUP BY day_of_week, hour;

GRANT SELECT ON public.hourly_activity_heatmap TO authenticated;

-- Source funnel breakdown (all time, for conversion funnel chart)
CREATE OR REPLACE VIEW public.source_funnel AS
SELECT
  l.source::text,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE l.stage NOT IN ('new_lead')) AS contacted,
  COUNT(*) FILTER (WHERE l.stage IN ('application_submitted','ai_called','counsellor_call','visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS applied,
  COUNT(*) FILTER (WHERE l.stage IN ('visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS visited,
  COUNT(*) FILTER (WHERE l.stage IN ('interview','offer_sent','token_paid','pre_admitted','admitted')) AS interviewed,
  COUNT(*) FILTER (WHERE l.stage IN ('offer_sent','token_paid','pre_admitted','admitted')) AS offered,
  COUNT(*) FILTER (WHERE l.stage IN ('token_paid','pre_admitted','admitted')) AS token_paid,
  COUNT(*) FILTER (WHERE l.stage = 'admitted') AS admitted
FROM public.leads l
GROUP BY l.source;

GRANT SELECT ON public.source_funnel TO authenticated;
