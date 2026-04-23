-- Fix: detect school leads by campus in addition to course hierarchy and JustDial category
-- School campuses: Avantika II (Beacon CBSE) and Avantika (Mirai IB)
-- Also exclude mirror leads from the bucket view

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
    -- 1. If lead has a course, use the institution type from the course hierarchy
    WHEN i.type IS NOT NULL THEN i.type
    -- 2. If lead's campus belongs to a school institution, mark as school
    WHEN cam_inst.type = 'school' THEN 'school'
    -- 3. If lead came from JustDial with a school category, mark as school
    WHEN jdm.is_school = true THEN 'school'
    -- 4. Default to college
    ELSE 'college'
  END AS bucket
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.departments d ON d.id = c.department_id
LEFT JOIN public.institutions i ON i.id = d.institution_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
-- Join to detect school campus even without a course
LEFT JOIN public.institutions cam_inst ON cam_inst.campus_id = l.campus_id AND cam_inst.type = 'school'
LEFT JOIN public.jd_category_mappings jdm ON lower(jdm.category) = lower(l.jd_category)
WHERE l.counsellor_id IS NULL
  AND l.stage NOT IN ('admitted', 'rejected')
  AND l.is_mirror = false;

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
