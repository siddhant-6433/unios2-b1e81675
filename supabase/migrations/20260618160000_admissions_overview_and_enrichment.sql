-- Admissions performance: collapse the CRM dashboard query burst into
-- two SECURITY INVOKER RPCs so RLS stays intact while query count drops.
--
-- 1. admissions_overview
--    Replaces the Admissions page's stage-count RPC + interested call_logs
--    lookup + 9 visit/action count queries + visit-funnel fetch.
--
-- 2. admissions_lead_enrichment
--    Replaces per-page application chunk hydration and AI-summary fetches
--    with one batched lookup keyed by lead ids.

CREATE OR REPLACE FUNCTION public.admissions_overview(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  scoped_leads AS (
    SELECT l.id, l.stage, l.counsellor_id, l.campus_id
    FROM public.leads l
    WHERE l.is_mirror = false
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
      AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
  ),
  stage_counts AS (
    SELECT l.stage::text AS stage, count(*)::int AS count
    FROM scoped_leads l
    GROUP BY l.stage
  ),
  interested_leads AS (
    SELECT DISTINCT cl.lead_id
    FROM public.call_logs cl
    JOIN scoped_leads l ON l.id = cl.lead_id
    WHERE cl.disposition = 'interested'
  ),
  missed_callbacks AS (
    SELECT count(*)::int AS c
    FROM public.call_logs cl
    JOIN scoped_leads l ON l.id = cl.lead_id
    WHERE cl.direction = 'inbound'
      AND cl.disposition = 'missed'
  ),
  overdue_followups AS (
    SELECT count(*)::int AS c
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
  ),
  ai_needs_followup AS (
    SELECT count(*)::int AS c
    FROM public.ai_call_records acr
    JOIN scoped_leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL
  ),
  visit_stats AS (
    SELECT
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= now()
      )::int AS scheduled,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= date_trunc('day', now())
          AND cv.visit_date < date_trunc('day', now()) + interval '1 day'
      )::int AS scheduled_today,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= now()
          AND cv.visit_date < now() + interval '7 days'
      )::int AS scheduled_this_week,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date < now()
      )::int AS checkin_pending,
      count(*) FILTER (
        WHERE cv.status = 'completed'
          AND cv.visit_date >= now() - interval '14 days'
      )::int AS visits_completed
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
  ),
  post_visit_pending AS (
    SELECT count(*)::int AS c
    FROM public.post_visit_pending_followups pv
    JOIN scoped_leads l ON l.id = pv.lead_id
  ),
  visit_funnel_raw AS (
    SELECT vf.lead_id, vf.funnel_box
    FROM public.visit_funnel_leads vf
    JOIN scoped_leads l ON l.id = vf.lead_id
    WHERE p_counsellor_id IS NULL OR vf.counsellor_id = p_counsellor_id
  ),
  visit_funnel_counts AS (
    SELECT funnel_box, count(*)::int AS count
    FROM visit_funnel_raw
    GROUP BY funnel_box
  ),
  visit_funnel_box_ids AS (
    SELECT jsonb_object_agg(funnel_box, lead_ids) AS boxes
    FROM (
      SELECT funnel_box, jsonb_agg(lead_id ORDER BY lead_id) AS lead_ids
      FROM visit_funnel_raw
      GROUP BY funnel_box
    ) grouped
  )
SELECT jsonb_build_object(
  'stage_counts',
  COALESCE(
    (SELECT jsonb_object_agg(stage, count) FROM stage_counts),
    '{}'::jsonb
  ),
  'interested_lead_ids',
  COALESCE(
    (SELECT jsonb_agg(lead_id ORDER BY lead_id) FROM interested_leads),
    '[]'::jsonb
  ),
  'visit_action_counts',
  jsonb_build_object(
    'missedCallbacks', (SELECT c FROM missed_callbacks),
    'overdueFollowups', (SELECT c FROM overdue_followups) + (SELECT c FROM ai_needs_followup),
    'scheduled', (SELECT scheduled FROM visit_stats),
    'scheduledToday', (SELECT scheduled_today FROM visit_stats),
    'scheduledThisWeek', (SELECT scheduled_this_week FROM visit_stats),
    'checkinPending', (SELECT checkin_pending FROM visit_stats),
    'visitsCompleted', (SELECT visits_completed FROM visit_stats),
    'visitsCompletedPendingFollowup', (SELECT c FROM post_visit_pending)
  ),
  'visit_funnel_counts',
  jsonb_build_object(
    'scheduled', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'scheduled'), 0),
    'confirmed', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'confirmed'), 0),
    'completed', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'completed'), 0),
    'visit_followup', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'visit_followup'), 0),
    'applied', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'applied'), 0),
    'admitted', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'admitted'), 0)
  ),
  'visit_funnel_leakage',
  COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'leakage'), 0),
  'visit_funnel_box_ids',
  COALESCE((SELECT boxes FROM visit_funnel_box_ids), '{}'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.admissions_overview(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admissions_lead_enrichment(
  p_lead_ids uuid[]
)
RETURNS TABLE (
  lead_id uuid,
  app_completion_pct integer,
  app_payment_status text,
  app_fee_amount numeric,
  ai_summary text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  requested AS (
    SELECT unnest(COALESCE(p_lead_ids, ARRAY[]::uuid[])) AS lead_id
  ),
  app_ranked AS (
    SELECT
      a.lead_id,
      CASE
        WHEN a.program_category = 'school' THEN round(100.0 * (
          (CASE WHEN a.completed_sections->>'personal' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'parents' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'siblings' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'questionnaire' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'academic' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'payment' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'documents' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'review' = 'true' THEN 1 ELSE 0 END)
        ) / 8.0)::int
        ELSE round(100.0 * (
          (CASE WHEN a.completed_sections->>'personal' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'parents' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'academic' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'extracurricular' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'payment' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'documents' = 'true' THEN 1 ELSE 0 END) +
          (CASE WHEN a.completed_sections->>'review' = 'true' THEN 1 ELSE 0 END)
        ) / 7.0)::int
      END AS app_completion_pct,
      a.payment_status::text AS app_payment_status,
      a.fee_amount::numeric AS app_fee_amount,
      row_number() OVER (
        PARTITION BY a.lead_id
        ORDER BY
          CASE
            WHEN a.program_category = 'school' THEN round(100.0 * (
              (CASE WHEN a.completed_sections->>'personal' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'parents' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'siblings' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'questionnaire' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'academic' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'payment' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'documents' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'review' = 'true' THEN 1 ELSE 0 END)
            ) / 8.0)::int
            ELSE round(100.0 * (
              (CASE WHEN a.completed_sections->>'personal' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'parents' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'academic' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'extracurricular' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'payment' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'documents' = 'true' THEN 1 ELSE 0 END) +
              (CASE WHEN a.completed_sections->>'review' = 'true' THEN 1 ELSE 0 END)
            ) / 7.0)::int
          END DESC,
          a.created_at DESC NULLS LAST,
          a.id DESC
      ) AS rn
    FROM public.applications a
    JOIN requested r ON r.lead_id = a.lead_id
  ),
  app_best AS (
    SELECT
      lead_id,
      app_completion_pct,
      app_payment_status,
      app_fee_amount
    FROM app_ranked
    WHERE rn = 1
  ),
  ai_ranked AS (
    SELECT
      acr.lead_id,
      acr.summary AS ai_summary,
      row_number() OVER (
        PARTITION BY acr.lead_id
        ORDER BY acr.created_at DESC NULLS LAST, acr.id DESC
      ) AS rn
    FROM public.ai_call_records acr
    JOIN requested r ON r.lead_id = acr.lead_id
    WHERE acr.summary IS NOT NULL
  ),
  ai_best AS (
    SELECT lead_id, ai_summary
    FROM ai_ranked
    WHERE rn = 1
  )
SELECT
  r.lead_id,
  a.app_completion_pct,
  a.app_payment_status,
  a.app_fee_amount,
  ai.ai_summary
FROM requested r
LEFT JOIN app_best a ON a.lead_id = r.lead_id
LEFT JOIN ai_best ai ON ai.lead_id = r.lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_lead_enrichment(uuid[]) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_call_logs_interested_lead
  ON public.call_logs (lead_id)
  WHERE disposition = 'interested';
