-- Route Meta Lead Ads leads to the correct bucket per Facebook Page.
--
-- Per business spec:
--   NIMT School page                 → school bucket (CBSE sub-bucket via Arthala campus)
--   Mirai Experiential School page   → school bucket (Mirai sub-bucket via Mirai campus)
--   NIMT Educational Institutions    → college bucket (umbrella brand, default)
--
-- The earlier 20260519130000 migration mapped all three Meta pages to
-- school. That was wrong: the NIMT Educational Institutions page runs
-- college-level admission ads even when an individual form happens to
-- mention school grades. This migration drops it from the school rule
-- and lets it fall through to 'college' (the default).
--
-- Sub-bucket split (CBSE vs Mirai) is driven by campus_id, which is
-- now set in lead-ingest based on meta_page_id. Backfill of existing
-- leads happens in the same deploy.

CREATE OR REPLACE FUNCTION public.get_unassigned_leads_bucket()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  course_id uuid,
  campus_id uuid,
  created_at timestamptz,
  lead_score integer,
  lead_temperature text,
  course_name text,
  campus_name text,
  bucket text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.phone,
    l.email,
    l.stage::text,
    l.source::text,
    l.course_id,
    l.campus_id,
    l.created_at,
    l.lead_score,
    l.lead_temperature,
    c.name   AS course_name,
    cam.name AS campus_name,
    CASE
      WHEN i.type IS NOT NULL          THEN i.type
      WHEN cam_inst.type = 'school'    THEN 'school'
      WHEN jdm.is_school = true        THEN 'school'
      WHEN l.source = 'meta_ads' AND l.meta_page_id IN (
        '111711207848445',   -- NIMT School (FB + IG)
        '1016687728205021'   -- Mirai Experiential School
      ) THEN 'school'
      ELSE 'college'
    END AS bucket
  FROM public.leads l
  LEFT JOIN public.courses c            ON c.id = l.course_id
  LEFT JOIN public.departments d        ON d.id = c.department_id
  LEFT JOIN public.institutions i       ON i.id = d.institution_id
  LEFT JOIN public.campuses cam         ON cam.id = l.campus_id
  LEFT JOIN public.institutions cam_inst
    ON cam_inst.campus_id = l.campus_id
    AND cam_inst.type = 'school'
  LEFT JOIN public.jd_category_mappings jdm
    ON lower(jdm.category) = lower(l.jd_category)
  WHERE l.counsellor_id IS NULL
    AND l.stage NOT IN ('admitted', 'rejected');
$$;

-- Backfill: set campus_id on existing Meta leads based on the Meta Page
-- they came in on. Only updates rows where campus_id is currently NULL —
-- never overwrites an explicit assignment.
UPDATE public.leads
SET campus_id = 'c0000001-0000-0000-0000-000000000002'::uuid
WHERE source = 'meta_ads'
  AND meta_page_id = '111711207848445'
  AND campus_id IS NULL;

UPDATE public.leads
SET campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid
WHERE source = 'meta_ads'
  AND meta_page_id = '1016687728205021'
  AND campus_id IS NULL;
