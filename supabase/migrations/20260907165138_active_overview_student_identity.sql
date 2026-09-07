-- Presence in get_active_overview used profiles.display_name, which for student
-- logins is the provisioned email (e.g. 91…@student.unios…). Resolve the
-- students row so the header "Active now" list can show name, course, and photo.

CREATE OR REPLACE FUNCTION public.get_active_overview(
  _lead_window_minutes integer DEFAULT 30,
  _include_leads boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'last_seen_at') DESC), '[]'::jsonb)
    INTO v_presence
  FROM (
    SELECT jsonb_build_object(
      'user_id', p.user_id,
      'display_name', CASE
        WHEN r.role = 'student' THEN COALESCE(NULLIF(btrim(stu.name), ''), p.display_name, 'Unnamed')
        WHEN r.role = 'parent' AND (p.display_name IS NULL OR p.display_name LIKE '%@%')
          THEN COALESCE('Parent of ' || NULLIF(btrim(stu.name), ''), p.display_name, 'Unnamed')
        ELSE COALESCE(p.display_name, 'Unnamed')
      END,
      'role', r.role,
      'campus', CASE
        WHEN r.role IN ('student', 'parent') THEN COALESCE(camp.name, p.campus)
        ELSE p.campus
      END,
      'last_seen_at', p.last_seen_at,
      'photo_url', CASE
        WHEN r.role IN ('student', 'parent')
          THEN COALESCE(NULLIF(stu.photo_processed_url, ''), NULLIF(stu.photo_url, ''))
        ELSE NULL
      END,
      'course_name', CASE
        WHEN r.role IN ('student', 'parent') THEN c.name
        ELSE NULL
      END
    ) AS row
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT ur.role::text AS role
      FROM public.user_roles ur
      WHERE ur.user_id = p.user_id
      ORDER BY ur.role
      LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT st.name, st.photo_url, st.photo_processed_url, st.course_id, st.campus_id
      FROM public.students st
      WHERE (r.role = 'student' AND st.user_id = p.user_id)
         OR (r.role = 'parent' AND (
              st.father_user_id = p.user_id
           OR st.mother_user_id = p.user_id
           OR st.guardian_user_id = p.user_id
         ))
      ORDER BY CASE WHEN st.user_id = p.user_id THEN 0 ELSE 1 END, st.updated_at DESC NULLS LAST
      LIMIT 1
    ) stu ON true
    LEFT JOIN public.courses c ON c.id = stu.course_id
    LEFT JOIN public.campuses camp ON camp.id = stu.campus_id
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

  IF v_is_super AND _include_leads THEN
    WITH engaged AS (
      SELECT h.id AS lead_id, h.name, h.phone, h.stage, h.last_engaged_at AS ts,
             h.last_event_type AS activity, h.counsellor_name
      FROM public.hot_engaged_leads h
      WHERE h.last_engaged_at > now() - make_interval(mins => _lead_window_minutes)
      UNION ALL
      SELECT cl.lead_id, l.name, l.phone, l.stage::text, cl.called_at, 'inbound_call',
             cp.display_name
      FROM public.call_logs cl
      JOIN public.leads l ON l.id = cl.lead_id
      LEFT JOIN public.profiles cp ON cp.id = l.counsellor_id
      WHERE cl.direction = 'inbound'
        AND cl.called_at > now() - make_interval(mins => _lead_window_minutes)
      UNION ALL
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
$function$;

REVOKE ALL ON FUNCTION public.get_active_overview(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_overview(integer, boolean) TO authenticated;
