-- Allow mirror leads in the bucket so Mirai team can pick them up
-- Mirrors are independent leads that need their own counsellor assignment

DROP VIEW IF EXISTS public.unassigned_leads_bucket CASCADE;

CREATE VIEW public.unassigned_leads_bucket AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.email,
  l.stage,
  l.source,
  l.course_id,
  l.campus_id,
  l.created_at,
  l.lead_score,
  l.lead_temperature,
  c.name AS course_name,
  cam.name AS campus_name,
  CASE
    WHEN i.type IS NOT NULL THEN i.type
    WHEN cam_inst.type = 'school' THEN 'school'
    WHEN jdm.is_school = true THEN 'school'
    ELSE 'college'
  END AS bucket
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.departments d ON d.id = c.department_id
LEFT JOIN public.institutions i ON i.id = d.institution_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
LEFT JOIN public.institutions cam_inst ON cam_inst.campus_id = l.campus_id AND cam_inst.type = 'school'
LEFT JOIN public.jd_category_mappings jdm ON lower(jdm.category) = lower(l.jd_category)
WHERE l.counsellor_id IS NULL
  AND l.stage NOT IN ('admitted', 'rejected');

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
