-- Collapse the Overview dashboard's hot-path summary into one RLS-safe
-- payload, then load heavier analytics through a second lazy RPC. The previous
-- client code issued many PostgREST requests and pulled broad row sets into
-- the browser before the first dashboard paint.
--
-- SECURITY INVOKER keeps table RLS in force for every subquery. This is a
-- performance rewrite, not a privilege expansion.

CREATE OR REPLACE FUNCTION public.dashboard_overview(
  p_campus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
lead_counts AS (
  SELECT
    COUNT(*)::bigint AS total_leads,
    COUNT(*) FILTER (WHERE l.created_at >= date_trunc('day', now()))::bigint AS today_leads,
    COUNT(*) FILTER (WHERE l.stage = 'admitted')::bigint AS admitted,
    COUNT(*) FILTER (
      WHERE l.stage IN (
        'application_in_progress',
        'application_fee_paid',
        'application_submitted',
        'offer_sent',
        'token_paid',
        'pre_admitted'
      )
    )::bigint AS app_in_progress,
    COUNT(*) FILTER (
      WHERE l.stage IN (
        'application_submitted',
        'offer_sent',
        'token_paid',
        'pre_admitted'
      )
    )::bigint AS app_submitted
  FROM public.leads l
  WHERE (p_campus_id IS NULL OR l.campus_id = p_campus_id)
),
student_counts AS (
  SELECT COUNT(*)::bigint AS students
  FROM public.students s
  WHERE (p_campus_id IS NULL OR s.campus_id = p_campus_id)
),
funnel AS (
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.stage), '[]'::jsonb) AS rows
  FROM (
    SELECT l.stage::text AS stage, COUNT(*)::bigint AS count
    FROM public.leads l
    WHERE (p_campus_id IS NULL OR l.campus_id = p_campus_id)
    GROUP BY l.stage
  ) x
),
recent_leads AS (
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC), '[]'::jsonb) AS rows
  FROM (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage::text AS stage,
      l.source::text AS source,
      l.created_at,
      c.name AS course_name,
      cmp.name AS campus_name
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
    WHERE (p_campus_id IS NULL OR l.campus_id = p_campus_id)
    ORDER BY l.created_at DESC
    LIMIT 5
  ) x
)
SELECT jsonb_build_object(
  'counts', jsonb_build_object(
    'total_leads', COALESCE((SELECT total_leads FROM lead_counts), 0),
    'today_leads', COALESCE((SELECT today_leads FROM lead_counts), 0),
    'admitted', COALESCE((SELECT admitted FROM lead_counts), 0),
    'students', COALESCE((SELECT students FROM student_counts), 0),
    'app_in_progress', COALESCE((SELECT app_in_progress FROM lead_counts), 0),
    'app_submitted', COALESCE((SELECT app_submitted FROM lead_counts), 0)
  ),
  'funnel', (SELECT rows FROM funnel),
  'recent_leads', (SELECT rows FROM recent_leads)
);
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_overview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_analytics(
  p_campus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
campus_students AS (
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.total DESC), '[]'::jsonb) AS rows
  FROM (
    SELECT
      COALESCE(c.name, 'Unknown') AS name,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE s.status = 'active')::bigint AS active
    FROM public.students s
    LEFT JOIN public.campuses c ON c.id = s.campus_id
    WHERE (p_campus_id IS NULL OR s.campus_id = p_campus_id)
    GROUP BY COALESCE(c.name, 'Unknown')
  ) x
),
fee_by_campus AS (
  SELECT
    COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.assigned DESC), '[]'::jsonb) AS rows,
    COALESCE(SUM(x.assigned), 0)::numeric AS assigned,
    COALESCE(SUM(x.paid), 0)::numeric AS paid,
    COALESCE(SUM(x.due), 0)::numeric AS due
  FROM (
    SELECT
      COALESCE(c.name, 'Unknown') AS name,
      COALESCE(SUM(fl.total_amount), 0)::numeric AS assigned,
      COALESCE(SUM(fl.paid_amount), 0)::numeric AS paid,
      COALESCE(SUM(fl.balance), 0)::numeric AS due
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
    LEFT JOIN public.campuses c ON c.id = s.campus_id
    WHERE (p_campus_id IS NULL OR s.campus_id = p_campus_id)
    GROUP BY COALESCE(c.name, 'Unknown')
    HAVING COALESCE(SUM(fl.total_amount), 0) > 0
  ) x
),
lead_sources AS (
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.count DESC), '[]'::jsonb) AS rows
  FROM (
    SELECT COALESCE(l.source::text, 'unknown') AS name, COUNT(*)::bigint AS count
    FROM public.leads l
    WHERE (p_campus_id IS NULL OR l.campus_id = p_campus_id)
    GROUP BY COALESCE(l.source::text, 'unknown')
    ORDER BY COUNT(*) DESC
    LIMIT 8
  ) x
),
days AS (
  SELECT generate_series(current_date - 6, current_date, interval '1 day')::date AS day
),
weekly_leads AS (
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.date), '[]'::jsonb) AS rows
  FROM (
    SELECT
      d.day::text AS date,
      COUNT(l.id)::bigint AS leads
    FROM days d
    LEFT JOIN public.leads l
      ON l.created_at::date = d.day
     AND (p_campus_id IS NULL OR l.campus_id = p_campus_id)
    GROUP BY d.day
  ) x
)
SELECT jsonb_build_object(
  'campus_students', (SELECT rows FROM campus_students),
  'fee_by_campus', (SELECT rows FROM fee_by_campus),
  'lead_sources', (SELECT rows FROM lead_sources),
  'weekly_leads', (SELECT rows FROM weekly_leads),
  'fee_total', jsonb_build_object(
    'assigned', COALESCE((SELECT assigned FROM fee_by_campus), 0),
    'paid', COALESCE((SELECT paid FROM fee_by_campus), 0),
    'due', COALESCE((SELECT due FROM fee_by_campus), 0)
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_analytics(uuid) TO authenticated;
