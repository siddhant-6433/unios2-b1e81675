-- Server-side aggregation for the CounsellorDashboard Activity Log tab.
--
-- Replaces the client-side fetchActivity() which pulled lead_activities and
-- call_logs to JS capped at .limit(500) each — so under load the per-counsellor
-- action counts were both slow AND silently truncated (a busy day easily blows
-- past 500 activities). This RPC aggregates on the server with no row cap.
--
-- SECURITY DEFINER: runs as the function owner, bypassing per-row RLS on
-- lead_activities / call_logs / leads. Restricted to authenticated callers.
--
-- Mirrors the exact client aggregation it replaces:
--   calls          = lead_activities(type='call') + every call_logs row (by user_id)
--   whatsapps/notes/stage_changes/ai_calls = lead_activities by type (by user_id)
--   total_call_duration / dispositions      = call_logs (by user_id)
--   total_leads / not_called = leads for the counsellor NOT in a closed stage,
--     un-dated (matches the old query), not_called = has no call_log in range.

CREATE OR REPLACE FUNCTION public.get_counsellor_activity_log(
  _from_date text DEFAULT NULL,
  _to_date   text DEFAULT NULL
)
RETURNS TABLE (
  counsellor_id       uuid,
  counsellor_name     text,
  user_id             uuid,
  calls               bigint,
  whatsapps           bigint,
  notes               bigint,
  stage_changes       bigint,
  ai_calls            bigint,
  total_call_duration bigint,
  dispositions        json,
  total_leads         bigint,
  not_called          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_ts timestamptz;
  _to_ts   timestamptz;
BEGIN
  _from_ts := CASE
    WHEN _from_date IS NOT NULL AND _from_date <> ''
    THEN (_from_date || 'T00:00:00')::timestamptz
  END;
  _to_ts := CASE
    WHEN _to_date IS NOT NULL AND _to_date <> ''
    THEN (_to_date || 'T23:59:59')::timestamptz
  END;

  RETURN QUERY
  WITH counsellors AS (
    SELECT p.id AS profile_id, p.display_name, p.user_id
    FROM   profiles p
    INNER JOIN user_roles ur ON ur.user_id = p.user_id
      AND ur.role IN ('counsellor', 'admission_head')
  ),
  -- lead_activities in range, per acting user_id, split by type
  activity_agg AS (
    SELECT
      la.user_id,
      COUNT(*) FILTER (WHERE la.type = 'call')         AS calls,
      COUNT(*) FILTER (WHERE la.type = 'whatsapp')     AS whatsapps,
      COUNT(*) FILTER (WHERE la.type = 'note')         AS notes,
      COUNT(*) FILTER (WHERE la.type = 'stage_change') AS stage_changes,
      COUNT(*) FILTER (WHERE la.type = 'ai_call')      AS ai_calls
    FROM lead_activities la
    WHERE la.user_id IS NOT NULL
      AND (_from_ts IS NULL OR la.created_at >= _from_ts)
      AND (_to_ts   IS NULL OR la.created_at <= _to_ts)
    GROUP BY la.user_id
  ),
  -- call_logs in range, per acting user_id: count, duration, dispositions
  call_agg AS (
    SELECT
      cl.user_id,
      COUNT(*)                                    AS calls,
      COALESCE(SUM(cl.duration_seconds), 0)       AS total_call_duration,
      COALESCE(
        (SELECT json_object_agg(d.disposition, d.cnt)
         FROM (
           SELECT c2.disposition, COUNT(*) AS cnt
           FROM call_logs c2
           WHERE c2.user_id = cl.user_id
             AND c2.disposition IS NOT NULL
             AND (_from_ts IS NULL OR c2.called_at >= _from_ts)
             AND (_to_ts   IS NULL OR c2.called_at <= _to_ts)
           GROUP BY c2.disposition
         ) d),
        '{}'::json
      )                                           AS dispositions
    FROM call_logs cl
    WHERE cl.user_id IS NOT NULL
      AND (_from_ts IS NULL OR cl.called_at >= _from_ts)
      AND (_to_ts   IS NULL OR cl.called_at <= _to_ts)
    GROUP BY cl.user_id
  ),
  -- Lead IDs that received at least one call within the date range
  called_lead_ids AS (
    SELECT DISTINCT cl.lead_id
    FROM call_logs cl
    WHERE (_from_ts IS NULL OR cl.called_at >= _from_ts)
      AND (_to_ts   IS NULL OR cl.called_at <= _to_ts)
  ),
  -- Open leads per counsellor (un-dated, matches the old client query)
  lead_agg AS (
    SELECT
      l.counsellor_id AS profile_id,
      COUNT(*)                                              AS total_leads,
      COUNT(*) FILTER (WHERE cli.lead_id IS NULL)           AS not_called
    FROM leads l
    LEFT JOIN called_lead_ids cli ON cli.lead_id = l.id
    WHERE l.counsellor_id IS NOT NULL
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
    GROUP BY l.counsellor_id
  )
  SELECT
    c.profile_id                                       AS counsellor_id,
    c.display_name                                     AS counsellor_name,
    c.user_id,
    (COALESCE(aa.calls, 0) + COALESCE(ca.calls, 0))    AS calls,
    COALESCE(aa.whatsapps,           0)                AS whatsapps,
    COALESCE(aa.notes,               0)                AS notes,
    COALESCE(aa.stage_changes,       0)                AS stage_changes,
    COALESCE(aa.ai_calls,            0)                AS ai_calls,
    COALESCE(ca.total_call_duration, 0)                AS total_call_duration,
    COALESCE(ca.dispositions,   '{}'::json)            AS dispositions,
    COALESCE(la.total_leads,         0)                AS total_leads,
    COALESCE(la.not_called,          0)                AS not_called
  FROM counsellors c
  LEFT JOIN activity_agg aa ON aa.user_id    = c.user_id
  LEFT JOIN call_agg     ca ON ca.user_id    = c.user_id
  LEFT JOIN lead_agg     la ON la.profile_id = c.profile_id
  -- Old client filtered to rows with at least one action
  WHERE (COALESCE(aa.calls, 0) + COALESCE(ca.calls, 0)
       + COALESCE(aa.whatsapps, 0) + COALESCE(aa.notes, 0)
       + COALESCE(aa.stage_changes, 0) + COALESCE(aa.ai_calls, 0)) > 0
  ORDER BY (COALESCE(aa.calls, 0) + COALESCE(ca.calls, 0)
          + COALESCE(aa.whatsapps, 0) + COALESCE(aa.notes, 0)) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_counsellor_activity_log(text, text) TO authenticated;
