-- View: completed visits (last 14 days) with no follow-up call or activity after the visit
CREATE OR REPLACE VIEW public.post_visit_pending_followups AS
SELECT
  cv.id AS visit_id,
  cv.lead_id,
  cv.campus_id,
  cv.visit_date,
  cv.updated_at AS visit_completed_at,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.stage AS lead_stage,
  l.counsellor_id,
  l.source AS lead_source,
  l.course_id,
  c.name AS campus_name,
  EXTRACT(DAY FROM now() - cv.visit_date)::integer AS days_since_visit
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
LEFT JOIN public.campuses c ON c.id = cv.campus_id
WHERE cv.status = 'completed'
  AND cv.visit_date >= now() - interval '14 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.call_logs cl
    WHERE cl.lead_id = cv.lead_id
      AND cl.called_at > cv.visit_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lead_followups lf
    WHERE lf.lead_id = cv.lead_id
      AND lf.status = 'completed'
      AND lf.completed_at > cv.visit_date
  )
ORDER BY cv.visit_date ASC;

GRANT SELECT ON public.post_visit_pending_followups TO authenticated;
