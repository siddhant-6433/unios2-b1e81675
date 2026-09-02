-- Header "active users" widget: who's online right now, scoped by the caller's role.
--   super_admin                          -> all recently-seen staff
--   campus_admin | principal | admission_head -> only active members of teams they lead
--   anyone else                          -> nothing
-- "Active" = last_seen_at within the last 2 minutes (same window as the green dot
-- in AdminPanel / the presence heartbeat). RLS already lets staff read every
-- profile's last_seen_at; this DEFINER fn only centralizes the team scoping.

CREATE OR REPLACE FUNCTION public.get_active_team_users()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  role text,
  campus text,
  last_seen_at timestamptz
)
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
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    COALESCE(p.display_name, 'Unnamed')::text,
    -- Primary role for the badge: pick one deterministically. Widget just needs
    -- a label, not the full additive set.
    (SELECT ur.role::text FROM public.user_roles ur
      WHERE ur.user_id = p.user_id ORDER BY ur.role LIMIT 1) AS role,
    p.campus::text,
    p.last_seen_at
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
  ORDER BY p.last_seen_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_team_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_team_users() TO authenticated;
