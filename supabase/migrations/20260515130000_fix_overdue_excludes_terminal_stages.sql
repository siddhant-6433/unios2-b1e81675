-- Fix: Exclude terminal-stage leads from overdue_followups view
-- Bug: Leads marked "Not Interested" were reappearing in overdue queue
-- because the view did not filter by lead stage.

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
  AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible')
ORDER BY lf.scheduled_at ASC;

-- Backfill: complete any pending followups for leads already in terminal stages
UPDATE public.lead_followups
SET status = 'completed', completed_at = now()
WHERE status = 'pending'
  AND lead_id IN (
    SELECT id FROM public.leads
    WHERE stage IN ('not_interested', 'dnc', 'rejected', 'ineligible')
  );
