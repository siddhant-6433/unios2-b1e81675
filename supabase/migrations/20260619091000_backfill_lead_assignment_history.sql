-- Backfill the new assignment history table from leads that are already
-- assigned. Exact historical source/assigner is not recoverable for old rows,
-- so these are marked as assigned with a null assigner.

INSERT INTO public.lead_assignment_history (
  lead_id,
  assigned_to,
  previous_counsellor_id,
  assigned_by_profile_id,
  assigned_by_user_id,
  assignment_source,
  bucket_name,
  lead_stage_at_assignment,
  created_at
)
SELECT
  l.id,
  l.counsellor_id,
  NULL,
  NULL,
  NULL,
  'assigned',
  CASE
    WHEN inferred.bucket = 'college' THEN 'College Leads'
    WHEN inferred.school_brand = 'mirai' THEN 'Mirai IB Leads'
    WHEN inferred.bucket = 'school' THEN 'CBSE School Leads'
    ELSE NULL
  END,
  l.stage,
  COALESCE(l.assigned_at, l.updated_at, l.created_at)
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.departments d ON d.id = c.department_id
LEFT JOIN public.institutions i ON i.id = d.institution_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
LEFT JOIN LATERAL (
  SELECT ci.type
  FROM public.institutions ci
  WHERE ci.campus_id = l.campus_id
    AND ci.type = 'school'
  LIMIT 1
) cam_inst ON true
LEFT JOIN LATERAL (
  SELECT jm.is_school
  FROM public.jd_category_mappings jm
  WHERE lower(jm.category) = lower(l.jd_category)
  LIMIT 1
) jdm ON true
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN i.type IS NOT NULL THEN i.type
      WHEN cam_inst.type = 'school' THEN 'school'
      WHEN jdm.is_school = true THEN 'school'
      ELSE 'college'
    END AS bucket,
    CASE
      WHEN COALESCE(i.type, CASE WHEN cam_inst.type = 'school' THEN 'school' END, CASE WHEN jdm.is_school THEN 'school' END, 'college') <> 'school' THEN NULL
      WHEN l.campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid THEN 'mirai'
      ELSE 'nimt'
    END AS school_brand
) inferred ON true
WHERE l.counsellor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.lead_assignment_history h
    WHERE h.lead_id = l.id
      AND h.assigned_to = l.counsellor_id
  );

NOTIFY pgrst, 'reload schema';
