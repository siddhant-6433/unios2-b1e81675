-- Fix lead bucket classification for school leads without a course_id
-- Previously, leads with no course defaulted to 'college' bucket.
-- Now also checks jd_category_mappings.is_school for JustDial leads.

CREATE OR REPLACE VIEW public.unassigned_leads_bucket AS
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
    -- 2. If lead came from JustDial with a school category, mark as school
    WHEN jdm.is_school = true THEN 'school'
    -- 3. Default to college
    ELSE 'college'
  END AS bucket
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.departments d ON d.id = c.department_id
LEFT JOIN public.institutions i ON i.id = d.institution_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
LEFT JOIN public.jd_category_mappings jdm ON lower(jdm.category) = lower(l.jd_category)
WHERE l.counsellor_id IS NULL
  AND l.stage NOT IN ('admitted', 'rejected');
