-- Update seat_matrix view to include institution_type so school seats
-- can be excluded from college totals and shown in a separate section.
-- Must DROP first because CREATE OR REPLACE cannot change column order.

DROP VIEW IF EXISTS public.seat_matrix;

CREATE VIEW public.seat_matrix AS
SELECT
  c.id              AS course_id,
  c.name            AS course_name,
  c.code            AS course_code,
  d.id              AS department_id,
  d.name            AS department_name,
  i.campus_id,
  cam.name          AS campus_name,
  i.type            AS institution_type,
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
GROUP BY c.id, c.name, c.code, d.id, d.name, i.campus_id, cam.name, i.type, er.intake_capacity;

GRANT SELECT ON public.seat_matrix TO authenticated;
