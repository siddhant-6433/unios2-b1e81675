-- Fix: counsellors can't see unassigned leads in buckets because RLS on leads
-- table only allows them to see their own assigned leads.
-- Solution: wrap the view query in a SECURITY DEFINER function that bypasses RLS.

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
  lead_score int,
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
    c.name AS course_name,
    cam.name AS campus_name,
    CASE
      WHEN i.type IS NOT NULL THEN i.type
      WHEN jdm.is_school = true THEN 'school'
      ELSE 'college'
    END AS bucket
  FROM leads l
  LEFT JOIN courses c ON c.id = l.course_id
  LEFT JOIN departments d ON d.id = c.department_id
  LEFT JOIN institutions i ON i.id = d.institution_id
  LEFT JOIN campuses cam ON cam.id = l.campus_id
  LEFT JOIN jd_category_mappings jdm ON lower(jdm.category) = lower(l.jd_category)
  WHERE l.counsellor_id IS NULL
    AND l.stage NOT IN ('admitted', 'rejected');
$$;

-- Recreate the view using the function
DROP VIEW IF EXISTS public.unassigned_leads_bucket;

CREATE OR REPLACE VIEW public.unassigned_leads_bucket AS
  SELECT * FROM public.get_unassigned_leads_bucket();

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket TO authenticated;
