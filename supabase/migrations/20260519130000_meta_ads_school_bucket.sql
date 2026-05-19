-- Classify Meta Lead Ads leads from school pages into the 'school' bucket.
--
-- Background: leads ingested via meta-leads-poll arrive with course_id /
-- campus_id / jd_category all NULL (Meta lead forms don't include those
-- fields). The existing classification falls through to 'college' for any
-- lead without one of those signals, so school-page Meta leads land in
-- the wrong bucket and counsellors looking at the school bucket see
-- nothing.
--
-- Fix: when source='meta_ads', map known school pages to 'school'. Page
-- IDs are listed inline (only three Meta pages are wired up to UniOs); if
-- a new school page is added later, append it here.

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
        '111711207848445',   -- NIMT School
        '443493925579',      -- NIMT Educational Institutions (currently school-only forms)
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
