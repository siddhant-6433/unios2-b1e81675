-- Exact metrics for /call-log.
--
-- The UI needs card totals and the counsellor breakdown to come from the same
-- scoped dataset. PostgREST planned counts are estimates, and mixing those with
-- page-local row counts can produce impossible metrics (for example, Total
-- Calls lower than the sum of disposition cards).

CREATE OR REPLACE FUNCTION public.call_log_metrics(
  p_from_date text DEFAULT NULL,
  p_to_date text DEFAULT NULL,
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH params AS (
  SELECT
    CASE
      WHEN NULLIF(p_from_date, '') IS NULL THEN NULL
      ELSE (p_from_date || 'T00:00:00')::timestamptz
    END AS from_ts,
    CASE
      WHEN NULLIF(p_to_date, '') IS NULL THEN NULL
      ELSE (p_to_date || 'T23:59:59')::timestamptz
    END AS to_ts
),
scoped AS (
  SELECT cl.user_id, cl.disposition
  FROM public.call_logs cl
  CROSS JOIN params p
  WHERE (p.from_ts IS NULL OR cl.created_at >= p.from_ts)
    AND (p.to_ts IS NULL OR cl.created_at <= p.to_ts)
    AND (p_counsellor_id IS NULL OR cl.user_id = p_counsellor_id)
),
totals AS (
  SELECT
    COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE disposition = 'interested')::integer AS interested,
    COUNT(*) FILTER (WHERE disposition = 'not_interested')::integer AS not_interested,
    COUNT(*) FILTER (WHERE disposition IN ('not_answered', 'no_answer', 'voicemail'))::integer AS no_answer,
    COUNT(*) FILTER (WHERE disposition = 'busy')::integer AS busy,
    COUNT(*) FILTER (WHERE disposition IN ('call_back', 'callback'))::integer AS call_back
  FROM scoped
),
counsellor_rows AS (
  SELECT
    s.user_id,
    COALESCE(p.display_name, 'Unknown') AS name,
    COUNT(*)::integer AS calls
  FROM scoped s
  LEFT JOIN public.profiles p ON p.user_id = s.user_id
  WHERE s.user_id IS NOT NULL
  GROUP BY s.user_id, p.display_name
),
counsellors AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', user_id,
        'name', name,
        'count', calls
      )
      ORDER BY calls DESC, name
    ),
    '[]'::jsonb
  ) AS rows
  FROM counsellor_rows
)
SELECT jsonb_build_object(
  'total', totals.total,
  'interested', totals.interested,
  'not_interested', totals.not_interested,
  'no_answer', totals.no_answer,
  'busy', totals.busy,
  'call_back', totals.call_back,
  'counsellors', counsellors.rows
)
FROM totals
CROSS JOIN counsellors;
$$;

GRANT EXECUTE ON FUNCTION public.call_log_metrics(text, text, uuid) TO authenticated;
