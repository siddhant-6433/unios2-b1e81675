-- Cloud Dialer: assigned call lists + two buckets the counsellor UI needs so the
-- dialer can be their single work surface.
--
--   cloud_dialer_campaign_queue()  — one assigned lead list as a dialable queue
--   my_call_lists()                — "which lists am I supposed to call?" + progress
--   cloud_dialer_queue()           — re-applied with two new buckets:
--                                      priority 0 = Pinned (cloud_dialer_pins was
--                                        written by two pages but read by nobody
--                                        since the RPC rewrite — "Add to Dialer"
--                                        silently did nothing)
--                                      priority 8 = Interested & Hot (folds the
--                                        HotLeadsSidebar into the queue)
--
-- Everything returns the exact jsonb shape CloudDialer.tsx already parses:
--   { queue: [ ...lead rows... ], buckets: [ { bucket_priority, label, count } ] }

-- ── 1. One assigned list as a queue ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue(
  p_list_id       uuid,
  p_counsellor_id uuid    DEFAULT NULL,
  p_limit         integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH members AS (
  SELECT m.lead_id, m.sort_order, m.added_at
  FROM public.lead_list_members m
  JOIN public.leads l ON l.id = m.lead_id
  WHERE m.list_id = p_list_id
    AND m.work_status = 'pending'
    AND l.phone IS NOT NULL
    AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
    AND (p_counsellor_id IS NULL OR m.assigned_to = p_counsellor_id)
  ORDER BY m.sort_order NULLS LAST, m.added_at
  LIMIT GREATEST(1, LEAST(p_limit, 1000))
),
attempts AS (
  SELECT acr.lead_id, count(*)::int AS attempt_count
  FROM public.ai_call_records acr
  WHERE acr.call_type = 'manual'
    AND acr.status <> 'counsellor_no_answer'
    AND acr.lead_id IN (SELECT lead_id FROM members)
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
    COALESCE(c.name, '—')   AS course_name,
    c.fee_per_year          AS course_fee_per_year,
    COALESCE(cmp.name, '—') AS campus_name,
    'Call List'::text       AS bucket,
    0                       AS bucket_priority,
    COALESCE(a.attempt_count, 0) AS attempt_count,
    l.assigned_at,
    l.first_contact_at,
    NULL::uuid AS followup_id,
    NULL::text AS followup_type,
    row_number() OVER (ORDER BY m.sort_order NULLS LAST, m.added_at) AS list_position
  FROM members m
  JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.courses c    ON c.id   = l.course_id
  LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
  LEFT JOIN attempts a          ON a.lead_id = m.lead_id
)
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.list_position) FROM enriched e),
    '[]'::jsonb
  ),
  'buckets', CASE
    WHEN (SELECT count(*) FROM enriched) > 0 THEN jsonb_build_array(jsonb_build_object(
      'bucket_priority', 0,
      'label', 'Call List',
      'count', (SELECT count(*)::int FROM enriched)
    ))
    ELSE '[]'::jsonb
  END
);
$$;

-- SECURITY INVOKER so RLS already returns nothing for anon, but there is no
-- reason for the endpoint to exist unauthenticated.
REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated;

-- ── 2. Lists assigned to me (+ progress) ─────────────────────────────────────
-- Counsellors see lists they hold members in. Admins/team leaders see every
-- active call list so they can watch progress from the same dropdown.

CREATE OR REPLACE FUNCTION public.my_call_lists()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (
                  SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id
                );

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.due_date NULLS LAST, x.pending DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      ll.id,
      ll.name,
      ll.priority_note,
      ll.due_date,
      count(*)::int                                                   AS total,
      count(*) FILTER (WHERE m.work_status = 'pending')::int           AS pending,
      count(*) FILTER (WHERE m.work_status = 'worked')::int            AS worked,
      count(*) FILTER (WHERE m.work_status = 'skipped')::int           AS skipped,
      max(m.worked_at)                                                 AS last_worked_at
    FROM public.lead_lists ll
    JOIN public.lead_list_members m ON m.list_id = ll.id
    WHERE ll.purpose = 'calling'
      AND ll.is_active
      AND (v_is_admin OR m.assigned_to = v_profile_id)
    GROUP BY ll.id, ll.name, ll.priority_note, ll.due_date
    HAVING count(*) FILTER (WHERE m.work_status = 'pending') > 0
        OR max(m.worked_at) > now() - interval '7 days'
  ) x;

  RETURN v_result;
END;
$$;

-- SECURITY DEFINER + the PUBLIC default grant means anon can call these over
-- /rest/v1/rpc. call_list_progress would hand out counsellor names and per-person
-- call counts for any list id to an unauthenticated caller.
REVOKE ALL ON FUNCTION public.my_call_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_call_lists() TO authenticated;

-- ── 3. Progress for one list (assigner view + counsellor progress bar) ───────

CREATE OR REPLACE FUNCTION public.call_list_progress(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'list_id', p_list_id,
    'total',   count(*)::int,
    'pending', count(*) FILTER (WHERE m.work_status = 'pending')::int,
    'worked',  count(*) FILTER (WHERE m.work_status = 'worked')::int,
    'skipped', count(*) FILTER (WHERE m.work_status = 'skipped')::int,
    'by_counsellor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'total',   c.total,
        'worked',  c.worked,
        'pending', c.pending
      ) ORDER BY c.pending DESC)
      FROM (
        SELECT m2.assigned_to,
               count(*)::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM public.lead_list_members m2
        WHERE m2.list_id = p_list_id AND m2.assigned_to IS NOT NULL
        GROUP BY m2.assigned_to
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  )
  FROM public.lead_list_members m
  WHERE m.list_id = p_list_id;
$$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated;

-- ── 4. Skip a list member from the dialer ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.skip_call_list_member(p_list_id uuid, p_lead_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.lead_list_members m
     SET work_status = 'skipped', worked_at = now()
   WHERE m.list_id = p_list_id
     AND m.lead_id = p_lead_id
     AND m.work_status = 'pending'
     AND m.assigned_to IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.skip_call_list_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_call_list_member(uuid, uuid) TO authenticated;

-- ── 5. cloud_dialer_queue + Pinned (0) and Interested & Hot (8) ──────────────

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

  -- Manual pins float to the very top. This bucket was documented in
  -- 20260517164016 but lost in a later rewrite, which quietly broke the
  -- "Add to Dialer" button on the lead page.
  b0 AS (
    SELECT l.id AS lead_id, 0 AS bucket_priority, 'Pinned'::text AS bucket,
           NULL::uuid AS followup_id, NULL::text AS followup_type
    FROM public.cloud_dialer_pins p
    JOIN public.leads l ON l.id = p.lead_id
    WHERE p.user_id = auth.uid()
      AND l.phone IS NOT NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
    ORDER BY p.created_at DESC
    LIMIT p_max_per_bucket
  ),
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
  -- Warm pipeline that no follow-up currently covers. Replaces the floating
  -- HotLeadsSidebar so the counsellor never has to leave the queue to find
  -- the leads most likely to convert.
  b8 AS (
    SELECT l.id AS lead_id, 8 AS bucket_priority, 'Interested & Hot'::text AS bucket,
           NULL::uuid AS followup_id, NULL::text AS followup_type
    FROM public.leads l
    WHERE l.phone IS NOT NULL
      -- No 'interested' value exists in lead_stage; 'counsellor_call' is the
      -- post-first-contact warm stage, and lead_temperature carries hot/warm/cold.
      AND (l.stage = 'counsellor_call' OR l.lead_temperature = 'hot')
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.updated_at DESC
    LIMIT p_max_per_bucket
  ),
  candidates AS (
    SELECT * FROM b0 UNION ALL SELECT * FROM b1 UNION ALL SELECT * FROM b2 UNION ALL
    SELECT * FROM b3 UNION ALL SELECT * FROM b4 UNION ALL
    SELECT * FROM b5 UNION ALL SELECT * FROM b6 UNION ALL
    SELECT * FROM b7 UNION ALL SELECT * FROM b8
  ),
  dedup AS (
    SELECT DISTINCT ON (lead_id) lead_id, bucket_priority, bucket, followup_id, followup_type
    FROM candidates
    ORDER BY lead_id, bucket_priority
  ),
  -- Counted AFTER dedup so the chip counts match what the counsellor can
  -- actually click through (the pre-dedup counts double-counted a lead that
  -- sat in two buckets).
  bucket_counts AS (
    SELECT bucket_priority, bucket, count(*)::int AS c
    FROM dedup
    GROUP BY bucket_priority, bucket
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
