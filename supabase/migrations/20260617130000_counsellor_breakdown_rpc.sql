-- Server-side aggregation for the CounsellorDashboard Breakdown tab.
--
-- Replaces the client-side fetchBreakdown() which was pulling ALL leads,
-- ALL call_logs, and ALL campus_visits to JS and aggregating there — with
-- no row limit. This caused the CounsellorDashboard to block on an
-- unbounded multi-table scan before showing the leaderboard tab.
--
-- SECURITY DEFINER: runs as the function owner (service role), bypassing
-- per-row RLS on leads / call_logs / campus_visits. Auth is enforced
-- by restricting to authenticated callers only.

CREATE OR REPLACE FUNCTION public.get_counsellor_breakdown(
  _from_date text DEFAULT NULL,
  _to_date   text DEFAULT NULL
)
RETURNS TABLE (
  counsellor_id        uuid,
  counsellor_name      text,
  user_id              uuid,
  total                bigint,
  new_lead             bigint,
  called               bigint,
  not_called           bigint,
  application_in_progress bigint,
  visit_scheduled      bigint,
  admitted             bigint,
  rejected             bigint,
  other_stages         bigint,
  visits_completed     bigint,
  avg_response_hrs     numeric,
  dispositions         json
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
  -- Leads scoped to the date range, one row per lead
  scoped_leads AS (
    SELECT
      l.id,
      l.counsellor_id AS profile_id,
      l.stage,
      l.assigned_at,
      l.first_contact_at
    FROM leads l
    WHERE l.counsellor_id IS NOT NULL
      AND (_from_ts IS NULL OR l.created_at >= _from_ts)
      AND (_to_ts   IS NULL OR l.created_at <= _to_ts)
  ),
  -- Lead IDs that received at least one call within the date range
  called_lead_ids AS (
    SELECT DISTINCT cl.lead_id
    FROM call_logs cl
    WHERE (_from_ts IS NULL OR cl.called_at >= _from_ts)
      AND (_to_ts   IS NULL OR cl.called_at <= _to_ts)
  ),
  -- Per-counsellor stage + call + response-time aggregation
  leads_agg AS (
    SELECT
      sl.profile_id,
      COUNT(*)                                                               AS total,
      COUNT(*) FILTER (WHERE sl.stage = 'new_lead')                         AS new_lead,
      COUNT(*) FILTER (WHERE sl.stage IN (
        'application_in_progress','application_fee_paid','application_submitted'
      ))                                                                     AS application_in_progress,
      COUNT(*) FILTER (WHERE sl.stage = 'visit_scheduled')                  AS visit_scheduled,
      COUNT(*) FILTER (WHERE sl.stage = 'admitted')                         AS admitted,
      COUNT(*) FILTER (WHERE sl.stage IN ('rejected','not_interested'))      AS rejected,
      COUNT(*) FILTER (WHERE sl.stage NOT IN (
        'new_lead','application_in_progress','application_fee_paid',
        'application_submitted','visit_scheduled','admitted',
        'rejected','not_interested'
      ))                                                                     AS other_stages,
      COUNT(*) FILTER (WHERE cl.lead_id IS NOT NULL)                        AS called,
      COUNT(*) FILTER (WHERE cl.lead_id IS NULL)                            AS not_called,
      ROUND(
        AVG(
          CASE
            WHEN sl.assigned_at IS NOT NULL AND sl.first_contact_at IS NOT NULL
              AND EXTRACT(EPOCH FROM (sl.first_contact_at - sl.assigned_at)) / 3600
                  BETWEEN 0 AND 720
            THEN EXTRACT(EPOCH FROM (sl.first_contact_at - sl.assigned_at)) / 3600
          END
        )::numeric, 1
      )                                                                     AS avg_response_hrs
    FROM scoped_leads sl
    LEFT JOIN called_lead_ids cl ON cl.lead_id = sl.id
    GROUP BY sl.profile_id
  ),
  -- Disposition counts per counsellor (keyed by user_id, not profile_id)
  disposition_agg AS (
    SELECT
      p.id AS profile_id,
      COALESCE(
        (SELECT json_object_agg(d.disposition, d.cnt)
         FROM (
           SELECT cl.disposition, COUNT(*) AS cnt
           FROM call_logs cl
           WHERE cl.user_id = p.user_id
             AND cl.disposition IS NOT NULL
             AND (_from_ts IS NULL OR cl.called_at >= _from_ts)
             AND (_to_ts   IS NULL OR cl.called_at <= _to_ts)
           GROUP BY cl.disposition
         ) d),
        '{}'::json
      ) AS dispositions
    FROM profiles p
    INNER JOIN user_roles ur ON ur.user_id = p.user_id
      AND ur.role IN ('counsellor', 'admission_head')
  ),
  -- Completed visit counts per counsellor (scheduled_by = profile_id)
  visits_agg AS (
    SELECT
      cv.scheduled_by AS profile_id,
      COUNT(*)         AS visits_completed
    FROM campus_visits cv
    WHERE cv.status = 'completed'
      AND (_from_ts IS NULL OR cv.visit_date::timestamptz >= _from_ts)
      AND (_to_ts   IS NULL OR cv.visit_date::timestamptz <= _to_ts)
    GROUP BY cv.scheduled_by
  )
  SELECT
    c.profile_id                              AS counsellor_id,
    c.display_name                            AS counsellor_name,
    c.user_id,
    COALESCE(la.total,                   0)   AS total,
    COALESCE(la.new_lead,               0)   AS new_lead,
    COALESCE(la.called,                  0)   AS called,
    COALESCE(la.not_called,             0)   AS not_called,
    COALESCE(la.application_in_progress,0)   AS application_in_progress,
    COALESCE(la.visit_scheduled,        0)   AS visit_scheduled,
    COALESCE(la.admitted,               0)   AS admitted,
    COALESCE(la.rejected,               0)   AS rejected,
    COALESCE(la.other_stages,           0)   AS other_stages,
    COALESCE(va.visits_completed,       0)   AS visits_completed,
    la.avg_response_hrs,
    COALESCE(da.dispositions,       '{}'::json) AS dispositions
  FROM counsellors c
  LEFT JOIN leads_agg     la ON la.profile_id = c.profile_id
  LEFT JOIN disposition_agg da ON da.profile_id = c.profile_id
  LEFT JOIN visits_agg    va ON va.profile_id = c.profile_id
  WHERE COALESCE(la.total, 0) > 0
  ORDER BY c.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_counsellor_breakdown(text, text) TO authenticated;
