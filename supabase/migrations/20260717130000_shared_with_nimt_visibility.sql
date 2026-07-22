-- Hide academic-partner *private* leads (shared_with_nimt = false) from the NIMT
-- team. Only super_admin retains visibility (with a UI flag); the owning partner
-- keeps its own separate SELECT policies and is unaffected. shared_with_nimt
-- defaults true, so every normal lead (website/ads/walk-in/consultant/…) is
-- untouched — only partner leads with the box unchecked become private.
--
-- Layers:
--   1. leads RLS "Staff can view leads": non-superadmin staff branches now
--      require shared_with_nimt. Covers direct reads + RLS-respecting RPCs.
--   2. SECURITY DEFINER counsellor-pool RPCs (bypass RLS): exclude private leads
--      so they never enter assignment buckets.

-- 1. RLS: only super_admin sees private leads among NIMT staff.
ALTER POLICY "Staff can view leads" ON public.leads
USING (
  has_role((SELECT auth.uid()), 'super_admin'::app_role)
  OR (
    shared_with_nimt AND (
      has_role((SELECT auth.uid()), 'campus_admin'::app_role)
      OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
      OR has_role((SELECT auth.uid()), 'principal'::app_role)
      OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
      OR (
        has_role((SELECT auth.uid()), 'counsellor'::app_role)
        AND counsellor_id IN (
          SELECT profiles.id FROM profiles WHERE profiles.user_id = (SELECT auth.uid())
        )
      )
      OR can_view_lead((SELECT auth.uid()), id)
    )
  )
);

-- 2a. Unassigned-leads bucket (counsellor pool UI) — never surface private leads.
CREATE OR REPLACE FUNCTION public.get_unassigned_leads_bucket()
 RETURNS TABLE(id uuid, name text, phone text, email text, stage text, source text, course_id uuid, campus_id uuid, created_at timestamp with time zone, lead_score integer, lead_temperature text, course_name text, campus_name text, bucket text, school_brand text, jd_category text, ai_called boolean, skip_ai_call boolean, ai_queue_status text, ai_not_called_reason text, last_ai_summary text, last_ai_disposition text, last_ai_conversion_pct integer, has_paid_or_submitted_application boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(l.skip_ai_call, false)              AS skip_ai_call,
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
      AND l.shared_with_nimt = true
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
  ),
  latest_queue AS (
    SELECT DISTINCT ON (lead_id)
      lead_id,
      status,
      error_message,
      scheduled_at,
      created_at
    FROM public.ai_call_queue
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
    cl.skip_ai_call,
    lq.status AS ai_queue_status,
    CASE
      WHEN cl.ai_called THEN NULL
      WHEN cl.phone IS NULL OR btrim(cl.phone) = '' THEN 'No phone number'
      WHEN cl.skip_ai_call THEN 'Skipped by import/manual flag'
      WHEN lq.status = 'pending' AND lq.scheduled_at > now() THEN 'Scheduled for AI call'
      WHEN lq.status = 'pending' THEN 'Queued for AI call'
      WHEN lq.status = 'processing' THEN 'AI call processing'
      WHEN lq.status = 'failed' THEN COALESCE(NULLIF(lq.error_message, ''), 'AI call queue failed')
      WHEN lq.status = 'skipped' THEN COALESCE(NULLIF(lq.error_message, ''), 'AI call skipped')
      WHEN cl.source IN ('consultant', 'walk_in', 'reference', 'referral', 'education_fair') THEN 'Human-handled source'
      ELSE 'No AI call queued'
    END AS ai_not_called_reason,
    la.summary                                          AS last_ai_summary,
    la.disposition                                      AS last_ai_disposition,
    la.conversion_probability::int                      AS last_ai_conversion_pct,
    cl.has_paid_or_submitted_application
  FROM classified cl
  LEFT JOIN latest_ai la ON la.lead_id = cl.id
  LEFT JOIN latest_queue lq ON lq.lead_id = cl.id;
$function$;

-- 2b. Counsellor auto-assignment pool — never assign private leads.
CREATE OR REPLACE FUNCTION public.get_leads_for_counsellor_assignment()
 RETURNS TABLE(lead_id uuid, campus_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.id AS lead_id, l.campus_id
  FROM leads l
  WHERE l.counsellor_id IS NULL
    AND l.shared_with_nimt = true
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
    AND (SELECT count(*) FROM ai_call_records r WHERE r.lead_id = l.id) >= 3
    AND (SELECT count(*) FROM ai_call_records r WHERE r.lead_id = l.id AND r.status = 'completed') = 0;
$function$;
