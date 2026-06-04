-- Collapse Action Center bucket fanout into one RLS-preserving payload call.
-- SECURITY INVOKER keeps access checks on the underlying tables as the caller.

CREATE OR REPLACE FUNCTION public.action_center_payload(
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
      date_trunc('day', now()) + interval '7 days' AS week_end,
      now() - interval '3 days' AS stalled_before
  ),

  overdue_ranked AS (
    SELECT
      lf.id,
      lf.lead_id,
      lf.scheduled_at,
      lf.type,
      l.name AS lead_name,
      l.phone AS lead_phone,
      l.stage AS lead_stage,
      l.counsellor_id,
      EXTRACT(DAY FROM now() - lf.scheduled_at)::integer AS days_overdue,
      row_number() OVER (PARTITION BY lf.lead_id ORDER BY lf.scheduled_at ASC, lf.id ASC) AS rn
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
  ),
  overdue AS (
    SELECT *
    FROM overdue_ranked
    WHERE rn = 1
    ORDER BY scheduled_at ASC
    LIMIT 50
  ),
  overdue_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'lead_id', lead_id,
      'name', lead_name,
      'phone', lead_phone,
      'stage', lead_stage,
      'source', '',
      'course_name', '',
      'campus_name', '',
      'counsellor_id', counsellor_id,
      'counsellor_name', NULL,
      'days_overdue', days_overdue,
      'followup_type', type,
      'scheduled_at', scheduled_at
    ) ORDER BY scheduled_at ASC), '[]'::jsonb) AS items
    FROM overdue
  ),

  new_leads AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      l.created_at,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name,
      EXTRACT(EPOCH FROM (now() - l.created_at)) AS age_seconds
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.created_at ASC
    LIMIT 50
  ),
  new_leads_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'lead_id', id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'assigned_ago', CASE
        WHEN age_seconds < 3600 THEN 'just now'
        WHEN age_seconds < 86400 THEN floor(age_seconds / 3600)::int::text || 'h ago'
        ELSE floor(age_seconds / 86400)::int::text || 'd ago'
      END
    ) ORDER BY created_at ASC), '[]'::jsonb) AS items
    FROM new_leads
  ),

  today_followups_ranked AS (
    SELECT
      lf.id,
      lf.lead_id,
      lf.scheduled_at,
      lf.type,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name,
      row_number() OVER (PARTITION BY lf.lead_id ORDER BY lf.scheduled_at ASC, lf.id ASC) AS rn
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN bounds b
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= b.today_start
      AND lf.scheduled_at < b.tomorrow_start
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND NOT EXISTS (SELECT 1 FROM overdue o WHERE o.lead_id = lf.lead_id)
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
  ),
  today_followups AS (
    SELECT *
    FROM today_followups_ranked
    WHERE rn = 1
    ORDER BY scheduled_at ASC
    LIMIT 50
  ),
  today_followups_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'lead_id', lead_id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'scheduled_at', scheduled_at,
      'followup_type', type
    ) ORDER BY scheduled_at ASC), '[]'::jsonb) AS items
    FROM today_followups
  ),

  today_visits AS (
    SELECT
      cv.id,
      cv.lead_id,
      cv.visit_date,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN bounds b
    WHERE cv.visit_date >= b.today_start
      AND cv.visit_date < b.tomorrow_start
      AND cv.status IN ('scheduled', 'confirmed')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY cv.visit_date ASC
    LIMIT 50
  ),
  today_visits_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'lead_id', lead_id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'visit_date', visit_date,
      'visit_campus', campus_name,
      'visit_id', id
    ) ORDER BY visit_date ASC), '[]'::jsonb) AS items
    FROM today_visits
  ),

  post_visit AS (
    SELECT
      cv.id AS visit_id,
      cv.lead_id,
      cv.visit_date,
      l.name AS lead_name,
      l.phone AS lead_phone,
      l.stage AS lead_stage,
      COALESCE(l.source::text, '') AS lead_source,
      l.counsellor_id,
      COALESCE(cam.name, '') AS campus_name,
      EXTRACT(DAY FROM now() - cv.visit_date)::integer AS days_since_visit
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
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
    ORDER BY cv.visit_date ASC
    LIMIT 50
  ),
  post_visit_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', visit_id,
      'lead_id', lead_id,
      'name', lead_name,
      'phone', lead_phone,
      'stage', lead_stage,
      'source', lead_source,
      'course_name', '',
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', NULL,
      'days_since_visit', days_since_visit,
      'visit_date', visit_date,
      'visit_id', visit_id
    ) ORDER BY visit_date ASC), '[]'::jsonb) AS items
    FROM post_visit
  ),

  stalled_apps AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      l.updated_at,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name,
      floor(EXTRACT(EPOCH FROM (now() - l.updated_at)) / 86400)::int AS days_inactive
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN bounds b
    WHERE l.stage IN ('application_in_progress', 'application_fee_paid', 'application_submitted')
      AND l.updated_at < b.stalled_before
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.updated_at ASC
    LIMIT 50
  ),
  stalled_apps_payload AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'lead_id', id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'days_inactive', days_inactive
    ) ORDER BY updated_at ASC), '[]'::jsonb) AS items
    FROM stalled_apps
  ),

  upcoming_followups AS (
    SELECT
      lf.id,
      lf.lead_id,
      lf.scheduled_at AS sort_at,
      lf.scheduled_at,
      lf.type,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN bounds b
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= b.tomorrow_start
      AND lf.scheduled_at <= b.week_end
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND NOT EXISTS (SELECT 1 FROM overdue o WHERE o.lead_id = lf.lead_id)
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY lf.scheduled_at ASC
    LIMIT 30
  ),
  upcoming_visits AS (
    SELECT
      cv.id,
      cv.lead_id,
      cv.visit_date AS sort_at,
      cv.visit_date,
      l.name,
      l.phone,
      l.stage,
      COALESCE(l.source::text, '') AS source,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      p.display_name AS counsellor_name
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN bounds b
    WHERE cv.visit_date >= b.tomorrow_start
      AND cv.visit_date <= b.week_end
      AND cv.status IN ('scheduled', 'confirmed')
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY cv.visit_date ASC
    LIMIT 30
  ),
  upcoming_all AS (
    SELECT sort_at, jsonb_build_object(
      'id', id,
      'lead_id', lead_id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'scheduled_at', scheduled_at,
      'followup_type', type
    ) AS payload
    FROM upcoming_followups
    UNION ALL
    SELECT sort_at, jsonb_build_object(
      'id', id,
      'lead_id', lead_id,
      'name', name,
      'phone', phone,
      'stage', stage,
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_id', counsellor_id,
      'counsellor_name', counsellor_name,
      'visit_date', visit_date,
      'visit_campus', campus_name,
      'visit_id', id
    ) AS payload
    FROM upcoming_visits
  ),
  upcoming_payload AS (
    SELECT COALESCE(jsonb_agg(payload ORDER BY sort_at ASC), '[]'::jsonb) AS items
    FROM upcoming_all
  )
SELECT jsonb_build_object(
  'overdueFollowups', (SELECT items FROM overdue_payload),
  'newLeads', (SELECT items FROM new_leads_payload),
  'todayFollowups', (SELECT items FROM today_followups_payload),
  'todayVisits', (SELECT items FROM today_visits_payload),
  'postVisitPending', (SELECT items FROM post_visit_payload),
  'stalledApps', (SELECT items FROM stalled_apps_payload),
  'upcomingWeek', (SELECT items FROM upcoming_payload)
);
$$;

GRANT EXECUTE ON FUNCTION public.action_center_payload(uuid) TO authenticated;
