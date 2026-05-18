-- One RPC builds the entire smart dialer queue: merges every bucket
-- (priority interested, missed callbacks, post-visit, visit checkin,
-- overdue, today, new leads), dedups, joins lead + course + campus
-- details, computes attempt counts, and returns everything in a single
-- jsonb payload.
--
-- Replaces 7 parallel client queries (each limit 500) + a sequential
-- chunked batch loop fetching lead details + another ai_call_records
-- aggregation. On a counsellor with a full pipeline this was 10–12 DB
-- round-trips; now it's 1.
--
-- p_counsellor_id: scope queue to a counsellor (counsellor's own profile
--                  ID for counsellor role, or any counsellor for admins).
--                  NULL = org-wide (admin "All" view).
-- p_max_per_bucket: cap rows pulled per bucket before dedup. 100 is more
--                   than any counsellor will dial in a session.

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

  -- 1: Priority Interested
  b1 AS (
    SELECT l.id AS lead_id, 1 AS bucket_priority, 'Priority Interested'::text AS bucket
    FROM public.leads l
    WHERE l.stage = 'priority_interested'
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.updated_at DESC
    LIMIT p_max_per_bucket
  ),
  -- 2: Missed Callbacks
  b2 AS (
    SELECT DISTINCT ON (acr.lead_id) acr.lead_id, 2, 'Missed Callback'::text
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY acr.lead_id, acr.created_at ASC
    LIMIT p_max_per_bucket
  ),
  -- 3: Post-Visit pending
  b3 AS (
    SELECT pv.lead_id, 3, 'Post-Visit'::text
    FROM public.post_visit_pending_followups pv
    JOIN public.leads l ON l.id = pv.lead_id
    WHERE l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR pv.counsellor_id = p_counsellor_id)
    ORDER BY pv.visit_date ASC
    LIMIT p_max_per_bucket
  ),
  -- 4: Visit Checkin (uses campus_visits; old code queried non-existent lead_visits)
  b4 AS (
    SELECT cv.lead_id, 4, 'Visit Checkin'::text
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled','confirmed')
      AND cv.visit_date >= (SELECT ts FROM today_start)
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY cv.visit_date ASC
    LIMIT p_max_per_bucket
  ),
  -- 5: Overdue (view already excludes terminal stages)
  b5 AS (
    SELECT ovr.lead_id, 5, 'Overdue'::text
    FROM public.overdue_followups ovr
    WHERE (p_counsellor_id IS NULL OR ovr.counsellor_id = p_counsellor_id)
    ORDER BY ovr.scheduled_at ASC
    LIMIT p_max_per_bucket
  ),
  -- 6: Today's followups
  b6 AS (
    SELECT lf.lead_id, 6, 'Today'::text
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
  -- 7: Brand-new leads with no first contact
  b7 AS (
    SELECT l.id, 7, 'New Lead'::text
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND l.phone IS NOT NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.created_at ASC
    LIMIT p_max_per_bucket
  ),
  candidates AS (
    SELECT * FROM b1 UNION ALL SELECT * FROM b2 UNION ALL
    SELECT * FROM b3 UNION ALL SELECT * FROM b4 UNION ALL
    SELECT * FROM b5 UNION ALL SELECT * FROM b6 UNION ALL
    SELECT * FROM b7
  ),
  -- Raw counts per bucket BEFORE dedup (drives the bucket pill counts in the UI)
  bucket_counts AS (
    SELECT bucket_priority, bucket, count(*)::int AS c
    FROM candidates
    GROUP BY bucket_priority, bucket
  ),
  -- Dedup: keep the highest-priority bucket per lead
  dedup AS (
    SELECT DISTINCT ON (lead_id) lead_id, bucket_priority, bucket
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
      COALESCE(a.attempt_count, 0) AS attempt_count
    FROM dedup d
    JOIN public.leads l ON l.id = d.lead_id
    LEFT JOIN public.courses c   ON c.id   = l.course_id
    LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
    LEFT JOIN attempts a ON a.lead_id = d.lead_id
    WHERE l.phone IS NOT NULL
  )
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.bucket_priority, e.id) FROM enriched e),
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

-- Supporting indexes: the bucket-gathering queries hit these patterns.
CREATE INDEX IF NOT EXISTS idx_leads_priority_interested
  ON public.leads (updated_at DESC)
  WHERE stage = 'priority_interested' AND phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_new_uncontacted
  ON public.leads (created_at ASC)
  WHERE stage = 'new_lead' AND first_contact_at IS NULL AND phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_needs_followup
  ON public.ai_call_records (lead_id, created_at)
  WHERE needs_followup = true AND followup_done_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_manual_lead
  ON public.ai_call_records (lead_id)
  WHERE call_type = 'manual';
