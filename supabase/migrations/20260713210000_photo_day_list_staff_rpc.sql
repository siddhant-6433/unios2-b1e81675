-- List campus staff with Photo Day capture status for assign UI.
-- Also fix assign_photo_day to resolve campus via profiles.campus text
-- (profiles has no campus_id column — matches user_assigned_campus_ids).

CREATE OR REPLACE FUNCTION public.assign_photo_day(
  _target_user_id uuid,
  _granted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_perm_id uuid;
  v_target_campus_ids uuid[];
  v_actor_is_sa boolean;
  v_ok boolean := false;
  v_cid uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_assign_photo_day(v_actor) THEN
    RAISE EXCEPTION 'Not allowed to assign Photo Day';
  END IF;

  IF _target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required';
  END IF;

  SELECT id INTO v_perm_id
  FROM public.permissions
  WHERE module = 'photo_day' AND action = 'capture';

  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION 'photo_day:capture permission is not registered';
  END IF;

  v_actor_is_sa := public.has_role(v_actor, 'super_admin'::public.app_role);

  IF NOT v_actor_is_sa THEN
    v_target_campus_ids := public.user_assigned_campus_ids(_target_user_id);
    IF coalesce(array_length(v_target_campus_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Target user has no campus set';
    END IF;

    FOREACH v_cid IN ARRAY v_target_campus_ids LOOP
      IF public.user_can_access_assigned_campus(v_actor, v_cid) THEN
        v_ok := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_ok THEN
      RAISE EXCEPTION 'Target user is outside your campus';
    END IF;
  END IF;

  INSERT INTO public.user_permission_overrides (user_id, permission_id, granted, granted_by)
  VALUES (_target_user_id, v_perm_id, _granted, v_actor)
  ON CONFLICT (user_id, permission_id) DO UPDATE
  SET granted = EXCLUDED.granted,
      granted_by = EXCLUDED.granted_by,
      created_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', _target_user_id,
    'granted', _granted,
    'permission', 'photo_day:capture'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_photo_day(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_photo_day_staff()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  role text,
  campus_id uuid,
  campus_name text,
  has_capture boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_sa boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_assign_photo_day(v_actor) THEN
    RAISE EXCEPTION 'Not allowed to list Photo Day staff';
  END IF;

  v_is_sa := public.has_role(v_actor, 'super_admin'::public.app_role);

  RETURN QUERY
  WITH capture_perm AS (
    SELECT p.id AS permission_id
    FROM public.permissions p
    WHERE p.module = 'photo_day' AND p.action = 'capture'
    LIMIT 1
  ),
  staff AS (
    SELECT
      pr.user_id,
      coalesce(nullif(pr.display_name, ''), pr.email, pr.user_id::text) AS display_name,
      ur.role::text AS role,
      c.id AS campus_id,
      coalesce(c.name, pr.campus) AS campus_name
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.user_id
    LEFT JOIN public.campuses c
      ON pr.campus IS NOT NULL
     AND btrim(pr.campus) <> ''
     AND (
       lower(c.name) = lower(pr.campus)
       OR lower(c.code) = lower(pr.campus)
     )
    WHERE ur.role::text NOT IN (
      'student', 'parent', 'consultant', 'academic_partner', 'publisher', 'academic_partner_offer_letter'
    )
      AND (
        v_is_sa
        OR (
          c.id IS NOT NULL
          AND public.user_can_access_assigned_campus(v_actor, c.id)
        )
      )
  ),
  overrides AS (
    SELECT upo.user_id, upo.granted
    FROM public.user_permission_overrides upo
    CROSS JOIN capture_perm cp
    WHERE upo.permission_id = cp.permission_id
  ),
  role_has AS (
    SELECT rp.role::text AS role
    FROM public.role_permissions rp
    CROSS JOIN capture_perm cp
    WHERE rp.permission_id = cp.permission_id
  )
  SELECT
    s.user_id,
    s.display_name,
    s.role,
    s.campus_id,
    s.campus_name,
    CASE
      WHEN o.granted IS TRUE THEN true
      WHEN o.granted IS FALSE THEN false
      WHEN rh.role IS NOT NULL THEN true
      ELSE false
    END AS has_capture
  FROM staff s
  LEFT JOIN overrides o ON o.user_id = s.user_id
  LEFT JOIN role_has rh ON rh.role = s.role
  ORDER BY s.campus_name NULLS LAST, s.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_photo_day_staff() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_photo_day_staff() IS
  'Staff list with effective photo_day:capture for Photo Day assign UI.';
