-- Within the New Lead bucket (priority 7), order leads by source tier so that
-- paid acquisition (meta_ads, google_ads) is dialed before website, then
-- everything else. State-based buckets (priority_interested, missed_callback,
-- post_visit, overdue, etc.) are NOT reordered — fresh paid leads are still
-- colder than warmer intent signals.
--
-- Source tier:
--   1 → meta_ads, google_ads        (paid; decay fastest)
--   2 → website, mirai_website       (owned inbound)
--   3 → everything else
--
-- Within each tier, oldest-first by created_at (FIFO so nobody starves).

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
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY cv.visit_date ASC
    LIMIT p_max_per_bucket
  ),
  b5 AS (
    SELECT ovr.lead_id, 5, 'Overdue'::text,
           NULL::uuid, NULL::text
    FROM public.overdue_followups ovr
    WHERE (p_counsellor_id IS NULL OR ovr.counsellor_id = p_counsellor_id)
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
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY lf.scheduled_at ASC
    LIMIT p_max_per_bucket
  ),
  -- New Lead bucket: paid sources first, then website, then everything else.
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
      -- Tie-breaker exposed so the client can order New Lead by source tier too.
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
