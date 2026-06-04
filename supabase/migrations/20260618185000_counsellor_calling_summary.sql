-- Server-side aggregation for Counsellor Dashboard calling tab.
-- SECURITY INVOKER keeps underlying RLS intact.

CREATE OR REPLACE FUNCTION public.counsellor_calling_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  counsellors AS (
    SELECT p.id AS profile_id, p.user_id, COALESCE(p.display_name, 'Unknown') AS name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role IN ('counsellor', 'admission_head')
  ),
  active_leads AS (
    SELECT l.id, l.counsellor_id, l.first_contact_at, l.assigned_at
    FROM public.leads l
    WHERE l.counsellor_id IS NOT NULL
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  ),
  active_counts AS (
    SELECT
      c.profile_id,
      COUNT(al.id)::integer AS active_leads,
      COUNT(al.id) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM public.call_logs cl
          WHERE cl.lead_id = al.id
        )
      )::integer AS not_called,
      ROUND(AVG(
        CASE
          WHEN al.assigned_at IS NOT NULL
           AND al.first_contact_at IS NOT NULL
           AND al.first_contact_at >= al.assigned_at
           AND al.first_contact_at < al.assigned_at + interval '720 hours'
          THEN EXTRACT(EPOCH FROM (al.first_contact_at - al.assigned_at)) / 3600
          ELSE NULL
        END
      )::numeric, 1) AS avg_response_hrs
    FROM counsellors c
    LEFT JOIN active_leads al ON al.counsellor_id = c.profile_id
    GROUP BY c.profile_id
  ),
  period_calls AS (
    SELECT cl.*
    FROM public.call_logs cl
    WHERE (p_from_date IS NULL OR cl.called_at >= p_from_date::timestamp)
      AND (p_to_date IS NULL OR cl.called_at < (p_to_date + 1)::timestamp)
  ),
  call_counts AS (
    SELECT
      c.profile_id,
      COUNT(pc.id)::integer AS calls_in_period,
      COALESCE(SUM(pc.duration_seconds), 0)::integer AS call_duration,
      COALESCE(jsonb_object_agg(pc.disposition, disp_count) FILTER (WHERE pc.disposition IS NOT NULL), '{}'::jsonb) AS dispositions
    FROM counsellors c
    LEFT JOIN LATERAL (
      SELECT disposition, COUNT(*)::integer AS disp_count
      FROM period_calls pc
      WHERE pc.user_id = c.user_id
      GROUP BY disposition
    ) d ON true
    LEFT JOIN period_calls pc ON false
    GROUP BY c.profile_id
  ),
  call_totals AS (
    SELECT
      c.profile_id,
      COALESCE(SUM(d.disp_count), 0)::integer AS calls_in_period,
      COALESCE((
        SELECT SUM(pc.duration_seconds)::integer
        FROM period_calls pc
        WHERE pc.user_id = c.user_id
      ), 0) AS call_duration,
      COALESCE(jsonb_object_agg(d.disposition, d.disp_count) FILTER (WHERE d.disposition IS NOT NULL), '{}'::jsonb) AS dispositions
    FROM counsellors c
    LEFT JOIN LATERAL (
      SELECT pc.disposition, COUNT(*)::integer AS disp_count
      FROM period_calls pc
      WHERE pc.user_id = c.user_id
      GROUP BY pc.disposition
    ) d ON true
    GROUP BY c.profile_id, c.user_id
  ),
  overdue_counts AS (
    SELECT c.profile_id, COUNT(lf.id)::integer AS overdue_followups
    FROM counsellors c
    LEFT JOIN public.leads l ON l.counsellor_id = c.profile_id
    LEFT JOIN public.lead_followups lf ON lf.lead_id = l.id
      AND lf.status = 'pending'
      AND lf.scheduled_at < now()
    GROUP BY c.profile_id
  ),
  rows AS (
    SELECT
      c.name,
      c.profile_id AS "profileId",
      c.user_id AS "userId",
      COALESCE(ac.active_leads, 0) AS "activeLeads",
      COALESCE(ac.not_called, 0) AS "notCalled",
      COALESCE(ct.calls_in_period, 0) AS "callsInPeriod",
      COALESCE(ct.call_duration, 0) AS "callDuration",
      COALESCE(oc.overdue_followups, 0) AS "overdueFollowups",
      ac.avg_response_hrs AS "avgResponseHrs",
      COALESCE(ct.dispositions, '{}'::jsonb) AS dispositions
    FROM counsellors c
    LEFT JOIN active_counts ac ON ac.profile_id = c.profile_id
    LEFT JOIN call_totals ct ON ct.profile_id = c.profile_id
    LEFT JOIN overdue_counts oc ON oc.profile_id = c.profile_id
    WHERE COALESCE(ac.active_leads, 0) > 0
    ORDER BY COALESCE(ac.not_called, 0) DESC
  )
SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)
FROM rows;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_calling_summary(date, date) TO authenticated;
