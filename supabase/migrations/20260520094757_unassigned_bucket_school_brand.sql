-- Add `school_brand` to the unassigned-leads bucket so the UI can filter by
-- CBSE vs Mirai without juggling NULL-safe campus filters from the client.
--
-- BUG: LeadBuckets.tsx counts the CBSE bucket via
--   .eq("bucket","school").or("campus_id.neq.<MIRAI>,campus_id.is.null")
-- PostgREST resolves that OR group inconsistently for this view (the
-- `is.null` branch was being dropped, leaving just `campus_id <> MIRAI`,
-- which Postgres NULL semantics then strip every null-campus row from).
-- Result: the CBSE card showed 13 (only non-null, non-Mirai rows) while
-- the table showed 89 (the schoolFilter="all" fallthrough path applies no
-- campus predicate at all). The 75 NULL-campus rows — Meta lead-form
-- leads that can't carry a campus_id — were the silent victims.
--
-- FIX: expose a derived `school_brand` column ('mirai' | 'nimt') from the
-- SECURITY DEFINER function. The client uses `.eq("school_brand","nimt")`
-- — no OR, no NULL ambiguity, no PostgREST quirks. `school_brand` is NULL
-- when bucket = 'college'.

-- The view depends on the function's row type; drop both before recreating
-- with the new column list.
DROP VIEW IF EXISTS public.unassigned_leads_bucket;
DROP FUNCTION IF EXISTS public.get_unassigned_leads_bucket();

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
  bucket text,
  school_brand text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH classified AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.stage::text                                AS stage,
      l.source::text                               AS source,
      l.course_id,
      l.campus_id,
      l.created_at,
      l.lead_score,
      l.lead_temperature,
      c.name                                       AS course_name,
      cam.name                                     AS campus_name,
      CASE
        WHEN i.type IS NOT NULL          THEN i.type
        WHEN cam_inst.type = 'school'    THEN 'school'
        WHEN jdm.is_school = true        THEN 'school'
        ELSE 'college'
      END                                          AS bucket
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
      AND l.stage NOT IN ('admitted', 'rejected')
  )
  SELECT
    id, name, phone, email, stage, source, course_id, campus_id,
    created_at, lead_score, lead_temperature, course_name, campus_name,
    bucket,
    CASE
      WHEN bucket <> 'school' THEN NULL
      WHEN campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid THEN 'mirai'
      ELSE 'nimt'
    END AS school_brand
  FROM classified;
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;

DROP VIEW IF EXISTS public.unassigned_leads_bucket;

CREATE VIEW public.unassigned_leads_bucket
WITH (security_invoker = true) AS
  SELECT * FROM public.get_unassigned_leads_bucket();

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
