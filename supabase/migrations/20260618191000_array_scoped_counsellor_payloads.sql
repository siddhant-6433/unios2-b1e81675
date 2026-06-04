-- Faster counsellor branches for sidebar/action badges and pending followups.
-- SECURITY INVOKER is retained. The functions still run as the caller; the
-- optimization is to resolve the counsellor's lead IDs once and reuse them.

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
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
  v_include_unassigned boolean;
  v_today_start timestamptz := date_trunc('day', now());
  v_tomorrow_start timestamptz := date_trunc('day', now()) + interval '1 day';
  v_lead_ids uuid[] := '{}'::uuid[];
  v_active_lead_ids uuid[] := '{}'::uuid[];
  v_overdue integer := 0;
  v_today integer := 0;
  v_fresh integer := 0;
  v_new_leads_total integer := 0;
  v_unassigned integer := 0;
  v_unclosed integer := 0;
  v_confirm integer := 0;
  v_post_visit integer := 0;
  v_ai_needs_followup integer := 0;
  v_missed_callbacks integer := 0;
  v_hot integer := 0;
  v_priority_interested_total integer := 0;
  v_wa_unread integer := 0;
  v_reclaim_soon integer := 0;
  v_tat_defaults integer := 0;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  SELECT p.id INTO v_own_profile_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_role_name = 'counsellor' THEN
    v_scope_counsellor_id := v_own_profile_id;
    v_include_unassigned := false;
  ELSE
    v_scope_counsellor_id := p_scope_counsellor_id;
    v_include_unassigned := COALESCE(p_include_unassigned, true);
  END IF;

  IF v_scope_counsellor_id IS NOT NULL THEN
    SELECT
      COALESCE(array_agg(l.id), '{}'::uuid[]),
      COALESCE(array_agg(l.id) FILTER (WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')), '{}'::uuid[]),
      COUNT(*) FILTER (WHERE l.stage = 'new_lead' AND l.first_contact_at IS NULL)::integer,
      COUNT(*) FILTER (WHERE l.stage = 'new_lead')::integer,
      COUNT(*) FILTER (WHERE l.stage = 'priority_interested')::integer
    INTO v_lead_ids, v_active_lead_ids, v_fresh, v_new_leads_total, v_hot
    FROM public.leads l
    WHERE l.counsellor_id = v_scope_counsellor_id;

    v_priority_interested_total := v_hot;

    IF cardinality(v_lead_ids) > 0 THEN
      IF cardinality(v_active_lead_ids) > 0 THEN
        SELECT COUNT(*)::integer INTO v_overdue
        FROM public.lead_followups lf
        WHERE lf.status = 'pending'
          AND lf.scheduled_at < now()
          AND lf.lead_id = ANY(v_active_lead_ids);

        SELECT COUNT(*)::integer INTO v_today
        FROM public.lead_followups lf
        WHERE lf.status = 'pending'
          AND lf.scheduled_at >= v_today_start
          AND lf.scheduled_at < v_tomorrow_start
          AND lf.lead_id = ANY(v_active_lead_ids);
      END IF;

      SELECT COUNT(*)::integer INTO v_unclosed
      FROM public.campus_visits cv
      WHERE cv.status IN ('scheduled', 'confirmed')
        AND cv.visit_date::date <= CURRENT_DATE
        AND cv.visit_date::date >= CURRENT_DATE - 7
        AND cv.lead_id = ANY(v_lead_ids);

      SELECT COUNT(*)::integer INTO v_confirm
      FROM public.campus_visits cv
      WHERE cv.status = 'scheduled'
        AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
        AND cv.lead_id = ANY(v_lead_ids);

      SELECT COUNT(*)::integer INTO v_post_visit
      FROM public.campus_visits cv
      WHERE cv.status = 'completed'
        AND cv.visit_date >= now() - interval '14 days'
        AND cv.lead_id = ANY(v_lead_ids)
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
        );

      SELECT COUNT(*)::integer INTO v_ai_needs_followup
      FROM public.ai_call_records acr
      WHERE acr.needs_followup = true
        AND acr.followup_done_at IS NULL
        AND acr.lead_id = ANY(v_lead_ids);

      SELECT COUNT(*)::integer INTO v_missed_callbacks
      FROM public.call_logs cl
      WHERE cl.direction = 'inbound'
        AND cl.disposition = 'missed'
        AND cl.lead_id = ANY(v_lead_ids);

      SELECT COUNT(*)::integer INTO v_wa_unread
      FROM public.whatsapp_messages wm
      WHERE wm.direction = 'inbound'
        AND wm.is_read = false
        AND wm.lead_id = ANY(v_lead_ids);

      v_reclaim_soon := public.fn_count_leads_reclaim_soon(v_scope_counsellor_id, 30);
    END IF;
  ELSE
    SELECT COUNT(*)::integer INTO v_overdue
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    SELECT COUNT(*)::integer INTO v_today
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    WHERE lf.status = 'pending'
      AND lf.scheduled_at >= v_today_start
      AND lf.scheduled_at < v_tomorrow_start
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold');

    SELECT COUNT(*)::integer INTO v_fresh
    FROM public.leads l
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL;

    SELECT COUNT(*)::integer INTO v_new_leads_total
    FROM public.leads l
    WHERE l.stage = 'new_lead';

    IF v_include_unassigned THEN
      SELECT COUNT(*)::integer INTO v_unassigned
      FROM public.leads l
      WHERE l.stage = 'new_lead'
        AND l.counsellor_id IS NULL;
    END IF;

    SELECT COUNT(*)::integer INTO v_unclosed
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status IN ('scheduled', 'confirmed')
      AND cv.visit_date::date <= CURRENT_DATE
      AND cv.visit_date::date >= CURRENT_DATE - 7;

    SELECT COUNT(*)::integer INTO v_confirm
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE cv.status = 'scheduled'
      AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1;

    SELECT COUNT(*)::integer INTO v_post_visit
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
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
      );

    SELECT COUNT(*)::integer INTO v_ai_needs_followup
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL;

    SELECT COUNT(*)::integer INTO v_missed_callbacks
    FROM public.call_logs cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.direction = 'inbound'
      AND cl.disposition = 'missed';

    SELECT COUNT(*)::integer INTO v_priority_interested_total
    FROM public.leads l
    WHERE l.stage = 'priority_interested';

    SELECT COUNT(*)::integer INTO v_wa_unread
    FROM public.whatsapp_messages wm
    WHERE wm.direction = 'inbound'
      AND wm.is_read = false;
  END IF;

  IF v_role_name = 'counsellor' THEN
    SELECT COALESCE(ctd.total_defaults, 0)::integer INTO v_tat_defaults
    FROM public.counsellor_tat_defaults ctd
    WHERE ctd.user_id = auth.uid()
    LIMIT 1;
    v_tat_defaults := COALESCE(v_tat_defaults, 0);
  ELSE
    SELECT COALESCE(SUM(ctd.total_defaults), 0)::integer INTO v_tat_defaults
    FROM public.counsellor_tat_defaults ctd;
  END IF;

  RETURN jsonb_build_object(
    'overdue', v_overdue,
    'today', v_today,
    'fresh', v_fresh,
    'new_leads_total', v_new_leads_total,
    'unassigned', v_unassigned,
    'unclosed', v_unclosed,
    'confirm', v_confirm,
    'post_visit', v_post_visit,
    'ai_needs_followup', v_ai_needs_followup,
    'missed_callbacks', v_missed_callbacks,
    'hot', v_hot,
    'priority_interested_total', v_priority_interested_total,
    'wa_unread', v_wa_unread,
    'reclaim_soon', v_reclaim_soon,
    'tat_defaults', v_tat_defaults
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.pending_followups_payload(
  p_tab text,
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false,
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
  v_unassigned_only boolean;
  v_page_no integer := GREATEST(COALESCE(p_page, 0), 0);
  v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_lead_ids uuid[] := '{}'::uuid[];
  v_payload jsonb;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  SELECT p.id INTO v_own_profile_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_role_name = 'counsellor' THEN
    v_scope_counsellor_id := v_own_profile_id;
    v_unassigned_only := false;
  ELSE
    v_scope_counsellor_id := p_scope_counsellor_id;
    v_unassigned_only := COALESCE(p_scope_unassigned, false);
  END IF;

  IF v_scope_counsellor_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(l.id), '{}'::uuid[])
    INTO v_lead_ids
    FROM public.leads l
    WHERE l.counsellor_id = v_scope_counsellor_id
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'cold');

    IF cardinality(v_lead_ids) = 0 THEN
      RETURN jsonb_build_object(
        'counts', jsonb_build_object('overdue', 0, 'today', 0, 'upcoming', 0, 'visit_confirm', 0, 'unclosed_visits', 0, 'post_visit', 0),
        'items', '[]'::jsonb
      );
    END IF;

    WITH
      bounds AS (
        SELECT
          date_trunc('day', now()) AS today_start,
          date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
          date_trunc('day', now()) + interval '7 days' AS week_end
      ),
      scoped_leads AS (
        SELECT l.*
        FROM public.leads l
        WHERE l.id = ANY(v_lead_ids)
      ),
      pending_followups AS (
        SELECT lf.*
        FROM public.lead_followups lf
        WHERE lf.status = 'pending'
          AND lf.lead_id = ANY(v_lead_ids)
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
        WHERE cv.status = 'scheduled'
          AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
          AND cv.lead_id = ANY(v_lead_ids)
      ),
      unclosed_visit_rows AS (
        SELECT cv.id AS visit_id
        FROM public.campus_visits cv
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date::date <= CURRENT_DATE
          AND cv.visit_date::date >= CURRENT_DATE - 7
          AND cv.lead_id = ANY(v_lead_ids)
      ),
      post_visit_rows AS (
        SELECT cv.id AS visit_id
        FROM public.campus_visits cv
        WHERE cv.status = 'completed'
          AND cv.visit_date >= now() - interval '14 days'
          AND cv.lead_id = ANY(v_lead_ids)
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
        FROM all_items
        ORDER BY
          CASE WHEN p_tab IN ('today', 'upcoming') THEN sort_at END DESC NULLS LAST,
          sort_at ASC
        LIMIT v_page_size
        OFFSET v_page_no * v_page_size
      )
    SELECT jsonb_build_object(
      'counts', (SELECT payload FROM counts),
      'items', COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at ASC) FROM paged_items), '[]'::jsonb)
    ) INTO v_payload;

    RETURN v_payload;
  END IF;

  -- Admin/global fallback keeps the previous RLS-preserving shape.
  WITH
    bounds AS (
      SELECT
        date_trunc('day', now()) AS today_start,
        date_trunc('day', now()) + interval '1 day' AS tomorrow_start,
        date_trunc('day', now()) + interval '7 days' AS week_end
    ),
    scoped_leads AS (
      SELECT l.*
      FROM public.leads l
      WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'cold')
        AND (v_unassigned_only = false OR l.counsellor_id IS NULL)
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
      FROM all_items
      ORDER BY
        CASE WHEN p_tab IN ('today', 'upcoming') THEN sort_at END DESC NULLS LAST,
        sort_at ASC
      LIMIT v_page_size
      OFFSET v_page_no * v_page_size
    )
  SELECT jsonb_build_object(
    'counts', (SELECT payload FROM counts),
    'items', COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at ASC) FROM paged_items), '[]'::jsonb)
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
