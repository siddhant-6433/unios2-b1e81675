-- Merge duplicate scheduled visits: keep the latest, cancel the rest
-- Only affects leads with multiple scheduled/confirmed visits

WITH ranked AS (
  SELECT id, lead_id, visit_date, status,
    ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY visit_date DESC) as rn
  FROM public.campus_visits
  WHERE status IN ('scheduled', 'confirmed')
)
UPDATE public.campus_visits
SET status = 'cancelled'
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);
