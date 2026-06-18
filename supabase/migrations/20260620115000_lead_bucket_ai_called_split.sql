-- Expose the lead-level AI-call flag in Lead Buckets and provide exact
-- per-bucket counts for AI-called vs not-called unassigned leads.

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
  school_brand text,
  jd_category text,
  ai_called boolean,
  last_ai_summary text,
  last_ai_disposition text,
  last_ai_conversion_pct integer,
  has_paid_or_submitted_application boolean
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
      l.jd_category                                AS jd_category,
      COALESCE(l.ai_called, false)                 AS ai_called,
      EXISTS (
        SELECT 1
        FROM public.applications a
        WHERE a.lead_id = l.id
          AND (
            a.payment_status = 'paid'
            OR a.submitted_at IS NOT NULL
            OR COALESCE(a.status, 'draft') NOT IN ('draft', 'in_progress')
          )
      )                                            AS has_paid_or_submitted_application,
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
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible')
      AND l.is_mirror = false
      AND COALESCE(l.person_role, 'lead') = 'lead'
  ),
  latest_ai AS (
    SELECT DISTINCT ON (lead_id)
      lead_id,
      summary,
      disposition,
      conversion_probability
    FROM public.ai_call_records
    WHERE summary IS NOT NULL
    ORDER BY lead_id, created_at DESC
  )
  SELECT
    cl.id, cl.name, cl.phone, cl.email, cl.stage, cl.source,
    cl.course_id, cl.campus_id, cl.created_at,
    cl.lead_score, cl.lead_temperature, cl.course_name, cl.campus_name,
    cl.bucket,
    CASE
      WHEN cl.bucket <> 'school' THEN NULL
      WHEN cl.campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid THEN 'mirai'
      ELSE 'nimt'
    END AS school_brand,
    cl.jd_category,
    cl.ai_called,
    la.summary                                          AS last_ai_summary,
    la.disposition                                      AS last_ai_disposition,
    la.conversion_probability::int                      AS last_ai_conversion_pct,
    cl.has_paid_or_submitted_application
  FROM classified cl
  LEFT JOIN latest_ai la ON la.lead_id = cl.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;

CREATE VIEW public.unassigned_leads_bucket
WITH (security_invoker = true)
AS
  SELECT * FROM public.get_unassigned_leads_bucket();

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;

CREATE OR REPLACE FUNCTION public.unassigned_bucket_ai_call_counts()
RETURNS TABLE (bucket_key text, ai_called boolean, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN bucket = 'college' THEN 'college'
      ELSE school_brand
    END AS bucket_key,
    ai_called,
    count(*)::bigint AS n
  FROM public.get_unassigned_leads_bucket()
  GROUP BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION public.unassigned_bucket_ai_call_counts() TO authenticated;
