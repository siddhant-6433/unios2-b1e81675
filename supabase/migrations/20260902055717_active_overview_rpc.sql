-- Header "active now" widget, sectioned. Supersedes get_active_team_users().
-- Returns two arrays in one call:
--   presence : login users online right now (last_seen_at < 2 min) — staff AND
--              portal users (students/parents/consultants/partners). The widget
--              buckets these into sections by role.
--   leads    : leads/applicants with recent INBOUND activity (page view, WhatsApp
--              reply, email open, chat — already rolled into leads.last_engaged_at /
--              hot_engaged_leads — plus inbound phone calls, which that rollup misses).
--
-- Scope: super_admin sees everything. campus_admin/principal/admission_head see
-- only their own team's online staff (presence), no leads section — org-wide lead
-- activity is a super_admin signal for now.
-- ponytail: scoped-lead users get no leads/portal section; wire team→lead scoping
-- later if a principal actually needs it (avoids the can_view_lead perf trap here).

DROP FUNCTION IF EXISTS public.get_active_team_users();

CREATE OR REPLACE FUNCTION public.get_active_overview(_lead_window_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_is_super boolean;
  v_is_scoped_lead boolean;
  v_presence jsonb;
  v_leads jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_uid LIMIT 1;

  v_is_super := public.has_role(v_uid, 'super_admin'::public.app_role);
  v_is_scoped_lead := public.has_role(v_uid, 'campus_admin'::public.app_role)
                   OR public.has_role(v_uid, 'principal'::public.app_role)
                   OR public.has_role(v_uid, 'admission_head'::public.app_role);

  IF NOT (v_is_super OR v_is_scoped_lead) THEN
    RETURN jsonb_build_object('presence', '[]'::jsonb, 'leads', '[]'::jsonb);
  END IF;

  -- ── presence: everyone online right now, scoped ────────────────────────────
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'last_seen_at') DESC), '[]'::jsonb)
    INTO v_presence
  FROM (
    SELECT jsonb_build_object(
      'user_id', p.user_id,
      'display_name', COALESCE(p.display_name, 'Unnamed'),
      'role', (SELECT ur.role::text FROM public.user_roles ur
                 WHERE ur.user_id = p.user_id ORDER BY ur.role LIMIT 1),
      'campus', p.campus,
      'last_seen_at', p.last_seen_at
    ) AS row
    FROM public.profiles p
    WHERE p.last_seen_at > now() - interval '2 minutes'
      AND p.archived_at IS NULL
      AND p.login_disabled IS NOT TRUE
      AND p.deleted_at IS NULL
      AND (
        v_is_super
        OR p.user_id IN (
          SELECT member.user_id
          FROM public.teams t
          JOIN public.team_members tm ON tm.team_id = t.id
          JOIN public.profiles member ON member.user_id = tm.user_id
          WHERE t.leader_id = v_profile_id
        )
      )
  ) s;

  -- ── leads: recent inbound activity (super_admin only for now) ──────────────
  IF v_is_super THEN
    WITH engaged AS (
      -- page views / whatsapp replies / email opens / chat — already aggregated
      SELECT h.id AS lead_id, h.name, h.phone, h.stage, h.last_engaged_at AS ts,
             h.last_event_type AS activity, h.counsellor_name
      FROM public.hot_engaged_leads h
      WHERE h.last_engaged_at > now() - make_interval(mins => _lead_window_minutes)
      UNION ALL
      -- inbound human calls (not captured by last_engaged_at)
      SELECT cl.lead_id, l.name, l.phone, l.stage::text, cl.called_at, 'inbound_call',
             cp.display_name
      FROM public.call_logs cl
      JOIN public.leads l ON l.id = cl.lead_id
      LEFT JOIN public.profiles cp ON cp.id = l.counsellor_id
      WHERE cl.direction = 'inbound'
        AND cl.called_at > now() - make_interval(mins => _lead_window_minutes)
      UNION ALL
      -- inbound AI-line calls
      SELECT ar.lead_id, l.name, l.phone, l.stage::text, ar.created_at, 'inbound_call',
             cp.display_name
      FROM public.ai_call_records ar
      JOIN public.leads l ON l.id = ar.lead_id
      LEFT JOIN public.profiles cp ON cp.id = l.counsellor_id
      WHERE ar.call_type = 'inbound'
        AND ar.created_at > now() - make_interval(mins => _lead_window_minutes)
    ),
    dedup AS (
      SELECT DISTINCT ON (e.lead_id)
        e.lead_id, e.name, e.phone, e.stage, e.ts, e.activity, e.counsellor_name
      FROM engaged e
      WHERE e.lead_id IS NOT NULL
      ORDER BY e.lead_id, e.ts DESC
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'lead_id', d.lead_id,
      'name', COALESCE(d.name, 'Unknown'),
      'phone', d.phone,
      'stage', d.stage,
      'last_activity_at', d.ts,
      'activity_type', d.activity,
      'is_applicant', (l.applied_at IS NOT NULL),
      'counsellor_name', d.counsellor_name
    ) ORDER BY d.ts DESC), '[]'::jsonb)
      INTO v_leads
    FROM dedup d
    JOIN public.leads l ON l.id = d.lead_id;
  ELSE
    v_leads := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object('presence', v_presence, 'leads', v_leads);
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_overview(integer) TO authenticated;
