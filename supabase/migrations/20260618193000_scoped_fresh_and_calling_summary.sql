-- Scope two remaining counsellor hot paths so counsellor sessions do not run
-- admin/team-wide scans. SECURITY INVOKER is retained.

CREATE OR REPLACE FUNCTION public.fresh_leads_payload(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_assignment_filter text DEFAULT 'all',
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role_name text;
  v_own_profile_id uuid;
  v_scope_counsellor_id uuid;
  v_assignment_filter text;
  v_page_no integer := GREATEST(COALESCE(p_page, 0), 0);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_total integer := 0;
  v_leads jsonb := '[]'::jsonb;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  SELECT p.id INTO v_own_profile_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_role_name = 'counsellor' THEN
    v_scope_counsellor_id := v_own_profile_id;
    v_assignment_filter := 'assigned';
  ELSE
    v_scope_counsellor_id := p_scope_counsellor_id;
    v_assignment_filter := COALESCE(p_assignment_filter, 'all');
  END IF;

  IF v_scope_counsellor_id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_total
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND l.counsellor_id = v_scope_counsellor_id;

    IF v_total > 0 THEN
      WITH page_rows AS (
        SELECT
          l.id,
          l.name,
          l.phone,
          COALESCE(l.source::text, '') AS source,
          l.created_at,
          l.counsellor_id,
          COALESCE(c.name, '—') AS course_name,
          COALESCE(cam.name, '—') AS campus_name,
          COALESCE(p.display_name, 'Unassigned') AS counsellor_name,
          floor(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600)::integer AS hours_since
        FROM public.leads l
        LEFT JOIN public.courses c ON c.id = l.course_id
        LEFT JOIN public.campuses cam ON cam.id = l.campus_id
        LEFT JOIN public.profiles p ON p.id = l.counsellor_id
        WHERE l.stage = 'new_lead'
          AND l.first_contact_at IS NULL
          AND l.counsellor_id = v_scope_counsellor_id
        ORDER BY l.created_at ASC
        LIMIT v_page_size
        OFFSET v_page_no * v_page_size
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id,
        'name', COALESCE(name, 'Unknown'),
        'phone', COALESCE(phone, ''),
        'source', source,
        'course_name', course_name,
        'campus_name', campus_name,
        'counsellor_name', counsellor_name,
        'counsellor_id', counsellor_id,
        'created_at', created_at,
        'hours_since', hours_since
      ) ORDER BY created_at ASC), '[]'::jsonb)
      INTO v_leads
      FROM page_rows;
    END IF;

    RETURN jsonb_build_object('totalCount', v_total, 'leads', v_leads);
  END IF;

  WITH filtered AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      COALESCE(l.source::text, '') AS source,
      l.created_at,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      COALESCE(p.display_name, 'Unassigned') AS counsellor_name,
      floor(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600)::integer AS hours_since
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND (v_assignment_filter <> 'assigned' OR l.counsellor_id IS NOT NULL)
      AND (v_assignment_filter <> 'unassigned' OR l.counsellor_id IS NULL)
  ),
  total AS (
    SELECT COUNT(*)::integer AS count FROM filtered
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at ASC
    LIMIT v_page_size
    OFFSET v_page_no * v_page_size
  )
  SELECT
    (SELECT count FROM total),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'name', COALESCE(name, 'Unknown'),
        'phone', COALESCE(phone, ''),
        'source', source,
        'course_name', course_name,
        'campus_name', campus_name,
        'counsellor_name', counsellor_name,
        'counsellor_id', counsellor_id,
        'created_at', created_at,
        'hours_since', hours_since
      ) ORDER BY created_at ASC)
      FROM page_rows
    ), '[]'::jsonb)
  INTO v_total, v_leads;

  RETURN jsonb_build_object('totalCount', v_total, 'leads', v_leads);
END;
$$;

CREATE OR REPLACE FUNCTION public.counsellor_calling_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role_name text;
  v_profile_id uuid;
  v_user_id uuid;
  v_name text;
  v_payload jsonb;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  IF v_role_name = 'counsellor' THEN
    SELECT p.id, p.user_id, COALESCE(p.display_name, 'Unknown')
    INTO v_profile_id, v_user_id, v_name
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
    LIMIT 1;

    IF v_profile_id IS NULL THEN
      RETURN '[]'::jsonb;
    END IF;

    WITH
      active_leads AS (
        SELECT l.id, l.first_contact_at, l.assigned_at
        FROM public.leads l
        WHERE l.counsellor_id = v_profile_id
          AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
      ),
      active_counts AS (
        SELECT
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
        FROM active_leads al
      ),
      period_calls AS (
        SELECT cl.*
        FROM public.call_logs cl
        WHERE cl.user_id = v_user_id
          AND (p_from_date IS NULL OR cl.called_at >= p_from_date::timestamp)
          AND (p_to_date IS NULL OR cl.called_at < (p_to_date + 1)::timestamp)
      ),
      call_totals AS (
        SELECT
          COUNT(*)::integer AS calls_in_period,
          COALESCE(SUM(duration_seconds), 0)::integer AS call_duration,
          COALESCE(jsonb_object_agg(disposition, disp_count) FILTER (WHERE disposition IS NOT NULL), '{}'::jsonb) AS dispositions
        FROM (
          SELECT pc.disposition, COUNT(*)::integer AS disp_count, SUM(pc.duration_seconds) AS duration_seconds
          FROM period_calls pc
          GROUP BY pc.disposition
        ) d
      ),
      overdue_counts AS (
        SELECT COUNT(lf.id)::integer AS overdue_followups
        FROM public.lead_followups lf
        WHERE lf.status = 'pending'
          AND lf.scheduled_at < now()
          AND lf.lead_id IN (SELECT id FROM active_leads)
      ),
      row_payload AS (
        SELECT jsonb_build_object(
          'name', v_name,
          'profileId', v_profile_id,
          'userId', v_user_id,
          'activeLeads', COALESCE(ac.active_leads, 0),
          'notCalled', COALESCE(ac.not_called, 0),
          'callsInPeriod', COALESCE(ct.calls_in_period, 0),
          'callDuration', COALESCE(ct.call_duration, 0),
          'overdueFollowups', COALESCE(oc.overdue_followups, 0),
          'avgResponseHrs', ac.avg_response_hrs,
          'dispositions', COALESCE(ct.dispositions, '{}'::jsonb)
        ) AS payload,
        COALESCE(ac.active_leads, 0) AS active_leads
        FROM active_counts ac
        CROSS JOIN call_totals ct
        CROSS JOIN overdue_counts oc
      )
    SELECT CASE WHEN active_leads > 0 THEN jsonb_build_array(payload) ELSE '[]'::jsonb END
    INTO v_payload
    FROM row_payload;

    RETURN COALESCE(v_payload, '[]'::jsonb);
  END IF;

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
  INTO v_payload
  FROM rows;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fresh_leads_payload(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.counsellor_calling_summary(date, date) TO authenticated;
NOTIFY pgrst, 'reload schema';
