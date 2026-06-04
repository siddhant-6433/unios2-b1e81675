-- Collapse Pending Follow-ups counts + current tab rows into one RLS-preserving call.
-- The function enforces counsellor self-scope from auth.uid(); admins can pass a filter.

CREATE OR REPLACE FUNCTION public.pending_followups_payload(
  p_tab text,
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  auth_scope AS (
    SELECT
      public.get_user_role(auth.uid())::text AS role_name,
      (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1) AS own_profile_id
  ),
  scope AS (
    SELECT
      CASE WHEN role_name = 'counsellor' THEN own_profile_id ELSE p_scope_counsellor_id END AS counsellor_id,
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_scope_unassigned, false) END AS unassigned_only,
      GREATEST(COALESCE(p_page, 0), 0) AS page_no,
      LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100) AS page_size
    FROM auth_scope
  ),
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
      date_trunc('day', now()) + interval '7 days' AS week_end
  ),
  scoped_leads AS (
    SELECT l.*
    FROM public.leads l
    CROSS JOIN scope s
    WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'cold')
      AND (
        s.counsellor_id IS NULL
        OR l.counsellor_id = s.counsellor_id
      )
      AND (
        s.unassigned_only = false
        OR l.counsellor_id IS NULL
      )
  ),
  pending_followups AS (
    SELECT lf.*
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
  ),
  followup_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at < b.tomorrow_start)::integer AS today,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.tomorrow_start AND lf.scheduled_at <= b.week_end)::integer AS upcoming
    FROM pending_followups lf
    CROSS JOIN bounds b
  ),
  visit_confirm_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_rows AS (
    SELECT cv.id AS visit_id
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    WHERE cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
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
  ),
  counts AS (
    SELECT jsonb_build_object(
      'overdue', COALESCE(fc.overdue, 0),
      'today', COALESCE(fc.today, 0),
      'upcoming', COALESCE(fc.upcoming, 0),
      'visit_confirm', (SELECT COUNT(*)::integer FROM visit_confirm_rows),
      'unclosed_visits', (SELECT COUNT(*)::integer FROM unclosed_visit_rows),
      'post_visit', (SELECT COUNT(*)::integer FROM post_visit_rows)
    ) AS payload
    FROM followup_counts fc
  ),

  followup_items AS (
    SELECT
      lf.scheduled_at AS sort_at,
      jsonb_build_object(
        'id', lf.id,
        'lead_id', lf.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', COALESCE(lf.type::text, 'call'),
        'scheduled_at', lf.scheduled_at,
        'notes', lf.notes,
        'days_overdue', GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - lf.scheduled_at)) / 86400)::integer),
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM pending_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    CROSS JOIN bounds b
    WHERE (
      (p_tab = 'overdue' AND lf.scheduled_at < b.today_start)
      OR (p_tab = 'today' AND lf.scheduled_at >= b.today_start AND lf.scheduled_at < b.tomorrow_start)
      OR (p_tab = 'upcoming' AND lf.scheduled_at >= b.tomorrow_start AND lf.scheduled_at <= b.week_end)
    )
  ),
  visit_confirm_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'visit_confirmation',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'urgency', CASE
          WHEN cv.visit_date::date = CURRENT_DATE THEN 'same_day'
          WHEN cv.visit_date::date = CURRENT_DATE + 1 THEN 'day_before'
          ELSE 'future'
        END,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'visit_confirm'
      AND cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
  ),
  unclosed_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', '',
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'counsellor_id', l.counsellor_id,
        'type', 'unclosed_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_overdue', floor(EXTRACT(EPOCH FROM (now() - cv.visit_date)) / 86400)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE p_tab = 'unclosed_visits'
      AND cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7
  ),
  post_visit_items AS (
    SELECT
      cv.visit_date AS sort_at,
      jsonb_build_object(
        'id', cv.id,
        'lead_id', cv.lead_id,
        'lead_name', COALESCE(l.name, 'Unknown'),
        'lead_phone', COALESCE(l.phone, ''),
        'lead_stage', COALESCE(l.stage::text, ''),
        'counsellor_name', '',
        'counsellor_id', l.counsellor_id,
        'type', 'post_visit',
        'scheduled_at', cv.visit_date,
        'notes', NULL,
        'days_since_visit', EXTRACT(DAY FROM now() - cv.visit_date)::integer,
        'campus_name', COALESCE(cam.name, '')
      ) AS payload
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
    LEFT JOIN public.campuses cam ON cam.id = cv.campus_id
    WHERE p_tab = 'post_visit'
      AND cv.status = 'completed'
      AND cv.visit_date >= now() - interval '14 days'
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
  ),
  all_items AS (
    SELECT * FROM followup_items
    UNION ALL SELECT * FROM visit_confirm_items
    UNION ALL SELECT * FROM unclosed_visit_items
    UNION ALL SELECT * FROM post_visit_items
  ),
  paged_items AS (
    SELECT payload, sort_at
    FROM all_items, scope s
    ORDER BY
      CASE WHEN p_tab IN ('today', 'upcoming') THEN sort_at END DESC NULLS LAST,
      sort_at ASC
    LIMIT (SELECT page_size FROM scope)
    OFFSET (SELECT page_no * page_size FROM scope)
  )
SELECT jsonb_build_object(
  'counts', (SELECT payload FROM counts),
  'items', COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at ASC) FROM paged_items), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer) TO authenticated;
