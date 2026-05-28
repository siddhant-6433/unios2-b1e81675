-- Add `cold` to lead_stage enum.
--
-- Semantics: counsellor or AI gave up after multiple unanswered attempts.
-- Cold is NOT terminal — the lead can be flipped back into the active funnel
-- if circumstances change — but it should not surface in active follow-up
-- queues, the unassigned-pickup bucket, or the AI retry queue.
--
-- Two entry points:
--   * Manual: counsellor marks cold after 2 failed unanswered attempts
--     (via the stage dropdown in LeadInfoCard).
--   * Automatic: ai-call-failed-handler flips stage to `cold` on the 3rd
--     consecutive failed AI call (alongside the round-robin counsellor
--     assignment that already happens).

ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'cold' BEFORE 'rejected';

-- Re-create the unassigned-leads bucket view to exclude `cold`, mirroring the
-- 2026-06-15 fix that excluded `not_interested`/`dnc`/`ineligible`. Without
-- this, manually-cold leads with a null counsellor_id would leak into the
-- pickup queue.

DROP VIEW     IF EXISTS public.unassigned_leads_bucket;
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
  last_ai_summary text,
  last_ai_disposition text,
  last_ai_conversion_pct integer
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
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible', 'cold')
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
    la.summary                                          AS last_ai_summary,
    la.disposition                                      AS last_ai_disposition,
    la.conversion_probability::int                      AS last_ai_conversion_pct
  FROM classified cl
  LEFT JOIN latest_ai la ON la.lead_id = cl.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;

CREATE VIEW public.unassigned_leads_bucket
WITH (security_invoker = true) AS
  SELECT * FROM public.get_unassigned_leads_bucket();

GRANT SELECT ON public.unassigned_leads_bucket TO authenticated;
