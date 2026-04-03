-- Feature 1: Seat/Intake Matrix
-- Add a proper intake_capacity column and create a seat_matrix view.

-- 1. Add intake_capacity to eligibility_rules
ALTER TABLE public.eligibility_rules
  ADD COLUMN IF NOT EXISTS intake_capacity integer DEFAULT NULL;

-- 2. Backfill from existing notes ("Intake: 60." pattern)
UPDATE public.eligibility_rules
SET intake_capacity = CAST(
  regexp_replace(notes, '.*Intake:\s*(\d+)\.?.*', '\1')
  AS integer
)
WHERE notes ~* 'intake:\s*\d+' AND intake_capacity IS NULL;

-- 3. Create seat_matrix view
CREATE OR REPLACE VIEW public.seat_matrix AS
SELECT
  c.id              AS course_id,
  c.name            AS course_name,
  c.code            AS course_code,
  d.id              AS department_id,
  d.name            AS department_name,
  i.campus_id,
  cam.name          AS campus_name,
  COALESCE(er.intake_capacity, 0) AS total_seats,
  COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pre_admitted')) AS admitted,
  COALESCE(er.intake_capacity, 0)
    - COUNT(s.id) FILTER (WHERE s.status IN ('active', 'pre_admitted')) AS available,
  COUNT(l.id) FILTER (WHERE l.stage NOT IN ('rejected', 'admitted')) AS pipeline_leads
FROM public.courses c
JOIN public.departments d   ON c.department_id = d.id
JOIN public.institutions i  ON d.institution_id = i.id
JOIN public.campuses cam    ON i.campus_id = cam.id
LEFT JOIN public.eligibility_rules er ON er.course_id = c.id
LEFT JOIN public.students s  ON s.course_id = c.id AND s.campus_id = i.campus_id
LEFT JOIN public.leads l     ON l.course_id = c.id AND l.campus_id = i.campus_id
GROUP BY c.id, c.name, c.code, d.id, d.name, i.campus_id, cam.name, er.intake_capacity;

-- 4. Grant access
GRANT SELECT ON public.seat_matrix TO authenticated;
