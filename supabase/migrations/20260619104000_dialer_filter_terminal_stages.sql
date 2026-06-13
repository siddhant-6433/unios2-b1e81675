-- Idempotent fix: ensure cold / not-interested / other terminal-stage leads
-- never appear in the Cloud Dialer queue.
--
-- Symptom: counsellors see "not interested", "cold", etc. leads in the dialer.
--
-- Root cause (two layers):
--   1. post_visit_pending_followups view had no stage guard, so completed-visit
--      leads that later moved to a terminal stage leaked into the Post-Visit bucket.
--   2. cloud_dialer_queue (prior to migration 20260618151000) did not filter
--      terminal stages from buckets b2–b6. If that migration was never applied
--      via Supabase MCP, the live function lacks the guard.
--
-- This migration is a CREATE OR REPLACE on both objects — safe to re-run.
-- It also cancels any pending followups that still exist for terminal-stage
-- leads (belt-and-suspenders backfill in case the trigger backfill was skipped).

-- ── 1. Update post_visit_pending_followups view ──────────────────────────────
CREATE OR REPLACE VIEW public.post_visit_pending_followups AS
SELECT
  cv.id AS visit_id,
  cv.lead_id,
  cv.campus_id,
  cv.visit_date,
  cv.updated_at AS visit_completed_at,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.stage AS lead_stage,
  l.counsellor_id,
  l.source AS lead_source,
  l.course_id,
  c.name AS campus_name,
  EXTRACT(DAY FROM now() - cv.visit_date)::integer AS days_since_visit
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
LEFT JOIN public.campuses c ON c.id = cv.campus_id
WHERE cv.status = 'completed'
  AND cv.visit_date >= now() - interval '14 days'
  AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
  AND NOT EXISTS (
    SELECT 1 FROM public.call_logs cl
    WHERE cl.lead_id = cv.lead_id
      AND cl.called_at > cv.visit_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lead_followups lf
    WHERE lf.lead_id = cv.lead_id
      AND lf.status = 'completed'
      AND lf.completed_at > cv.visit_date
  )
ORDER BY cv.visit_date ASC;

GRANT SELECT ON public.post_visit_pending_followups TO authenticated;

-- ── 2. Re-apply cloud_dialer_queue with terminal-stage guards ────────────────
-- Identical to migration 20260618151000 which may not have been applied due to
-- migration-history drift in CI. This is safe: CREATE OR REPLACE is idempotent.

CREATE OR REPLACE FUNCTION public.cloud_dialer_queue(
  p_counsellor_id  uuid    DEFAULT NULL,
  p_max_per_bucket integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  today_start AS (SELECT date_trunc('day', now()) AS ts),
  today_end   AS (SELECT (date_trunc('day', now()) + interval '1 day') AS ts),

  b1 AS (
    SELECT l.id AS lead_id, 1 AS bucket_priority, 'Priority Interested'::text AS bucket,
           NULL::uuid AS followup_id, NULL::text AS followup_type
    FROM public.leads l
    WHERE l.stage = 'priority_interested'
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.updated_at DESC
    LIMIT p_max_per_bucket
  ),
  b2 AS (
    SELECT DISTINCT ON (acr.lead_id) acr.lead_id, 2, 'Missed Callback'::text,
           NULL::uuid, NULL::text
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL
      AND l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY acr.lead_id, acr.created_at ASC
    LIMIT p_max_per_bucket
  ),
  b3 AS (
    SELECT pv.lead_id, 3, 'Post-Visit'::text,
           NULL::uuid, NULL::text
    FROM public.post_visit_pending_followups pv
    JOIN public.leads l ON l.id = pv.lead_id
    WHERE l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR pv.counsellor_id = p_counsellor_id)
    ORDER BY pv.visit_date ASC
    LIMIT p_max_per_bucket
  ),
  b4 AS (
    SELECT cv.lead_id, 4, 'Visit Checkin'::text,
           NULL::uuid, NULL::text
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled','confirmed')
      AND cv.visit_date >= (SELECT ts FROM today_start)
      AND l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY cv.visit_date ASC
    LIMIT p_max_per_bucket
  ),
  b5 AS (
    SELECT ovr.lead_id, 5, 'Overdue'::text,
           ovr.id AS followup_id, ovr.type AS followup_type
    FROM public.overdue_followups ovr
    WHERE (p_counsellor_id IS NULL OR ovr.counsellor_id = p_counsellor_id)
      AND ovr.lead_stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
    ORDER BY ovr.scheduled_at ASC
    LIMIT p_max_per_bucket
  ),
  b6 AS (
    SELECT lf.lead_id, 6, 'Today'::text,
           lf.id AS followup_id, lf.type AS followup_type
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= (SELECT ts FROM today_start)
      AND lf.scheduled_at <  (SELECT ts FROM today_end)
      AND l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY lf.scheduled_at ASC
    LIMIT p_max_per_bucket
  ),
  b7 AS (
    SELECT l.id AS lead_id, 7 AS bucket_priority, 'New Lead'::text AS bucket,
           NULL::uuid AS followup_id, NULL::text AS followup_type
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY
      CASE l.source
        WHEN 'meta_ads'      THEN 1
        WHEN 'google_ads'    THEN 1
        WHEN 'website'       THEN 2
        WHEN 'mirai_website' THEN 2
        ELSE 3
      END,
      l.created_at ASC
    LIMIT p_max_per_bucket
  ),
  candidates AS (
    SELECT * FROM b1 UNION ALL SELECT * FROM b2 UNION ALL
    SELECT * FROM b3 UNION ALL SELECT * FROM b4 UNION ALL
    SELECT * FROM b5 UNION ALL SELECT * FROM b6 UNION ALL
    SELECT * FROM b7
  ),
  bucket_counts AS (
    SELECT bucket_priority, bucket, count(*)::int AS c
    FROM candidates
    GROUP BY bucket_priority, bucket
  ),
  dedup AS (
    SELECT DISTINCT ON (lead_id) lead_id, bucket_priority, bucket, followup_id, followup_type
    FROM candidates
    ORDER BY lead_id, bucket_priority
  ),
  attempts AS (
    SELECT acr.lead_id, count(*)::int AS attempt_count
    FROM public.ai_call_records acr
    WHERE acr.call_type = 'manual'
      AND acr.status <> 'counsellor_no_answer'
      AND acr.lead_id IN (SELECT lead_id FROM dedup)
    GROUP BY acr.lead_id
  ),
  enriched AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage,
      l.source,
      l.course_id,
      COALESCE(c.name, '—')  AS course_name,
      c.fee_per_year         AS course_fee_per_year,
      COALESCE(cmp.name, '—') AS campus_name,
      d.bucket,
      d.bucket_priority,
      COALESCE(a.attempt_count, 0) AS attempt_count,
      l.assigned_at,
      l.first_contact_at,
      d.followup_id,
      d.followup_type,
      CASE l.source
        WHEN 'meta_ads'      THEN 1
        WHEN 'google_ads'    THEN 1
        WHEN 'website'       THEN 2
        WHEN 'mirai_website' THEN 2
        ELSE 3
      END AS source_tier
    FROM dedup d
    JOIN public.leads l ON l.id = d.lead_id
    LEFT JOIN public.courses c   ON c.id   = l.course_id
    LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
    LEFT JOIN attempts a ON a.lead_id = d.lead_id
    WHERE l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
  )
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.bucket_priority, e.source_tier, e.id) FROM enriched e),
    '[]'::jsonb
  ),
  'buckets', COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'bucket_priority', bucket_priority,
        'label',           bucket,
        'count',           c
      ) ORDER BY bucket_priority) FROM bucket_counts),
    '[]'::jsonb
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.cloud_dialer_queue(uuid, integer) TO authenticated;

-- ── 3. Backfill: cancel any pending followups that still exist for terminal leads
-- Safe to re-run: only affects rows still in 'pending' status.
UPDATE public.lead_followups lf
SET status = 'cancelled',
    completed_at = COALESCE(lf.completed_at, now())
FROM public.leads l
WHERE lf.lead_id = l.id
  AND lf.status = 'pending'
  AND l.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');
