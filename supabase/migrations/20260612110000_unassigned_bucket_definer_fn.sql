-- Restore counsellor visibility into the unassigned leads bucket.
--
-- BUG: `unassigned_leads_bucket` is currently a SECURITY INVOKER view that
-- selects from `leads` directly. Counsellor RLS on `leads` only exposes
-- rows they're the assigned counsellor on, so for any real counsellor the
-- bucket returns 0 rows. Super-admins see correct data because their RLS
-- short-circuit lets every row through. When a super-admin "impersonates"
-- a counsellor in the UI, `auth.uid()` is still the super-admin's so the
-- bug stays hidden.
--
-- FIX: rebuild the view to call the existing SECURITY DEFINER function
-- `get_unassigned_leads_bucket()`. The function runs as postgres and
-- bypasses RLS in its body — exactly the pattern that was originally
-- introduced in 20260513170001 but later regressed when the view was
-- recreated without the function call.
--
-- We keep `security_invoker=true` on the view so the Supabase linter
-- stays happy; the RLS bypass lives in the function, not the view.
--
-- The function body is also refreshed so bucket classification matches
-- the live view's logic (school detection via `institutions.campus_id`
-- in addition to the course-hierarchy and JD-category checks).

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

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;

DROP VIEW IF EXISTS public.unassigned_leads_bucket;

CREATE VIEW public.unassigned_leads_bucket
WITH (security_invoker = true) AS
  SELECT * FROM public.get_unassigned_leads_bucket();

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
