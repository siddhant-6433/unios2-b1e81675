-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260923150559; git must keep this timestamp for `db push`.
--
-- Library access matrix: search + limit on the server.
--
-- The first version returned every non-student/parent profile (3,538 rows here) and
-- had no search, so the UI filtered client-side. With nobody assigned yet the matrix
-- rendered blank. This version:
--   * filters by name/email/role on the server (searchable),
--   * always includes people who already have access,
--   * with no search, returns librarian-role candidates so the list is never empty,
--   * caps the result with `_limit`.
DROP FUNCTION IF EXISTS public.library_access_matrix(uuid);

CREATE OR REPLACE FUNCTION public.library_access_matrix(
  _branch_id uuid,
  _search text DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  email text,
  phone text,
  app_role text,
  assignment_id uuid,
  assignment_role text,
  can_catalog boolean,
  can_circulate boolean,
  can_inventory boolean,
  can_digitize boolean,
  can_manage_settings boolean,
  active boolean,
  has_assignment boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := nullif(btrim(coalesce(_search, '')), '');
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'manage_settings') THEN
    RAISE EXCEPTION 'You do not have permission to manage library access';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.display_name,
    p.email,
    p.phone,
    public.get_user_role(p.user_id)::text,
    a.id,
    a.assignment_role,
    coalesce(a.can_catalog, false),
    coalesce(a.can_circulate, false),
    coalesce(a.can_inventory, false),
    coalesce(a.can_digitize, false),
    coalesce(a.can_manage_settings, false),
    coalesce(a.active, false),
    (a.id IS NOT NULL)
  FROM public.profiles p
  LEFT JOIN public.library_staff_assignments a
    ON a.branch_id = _branch_id
   AND a.user_id = p.user_id
  WHERE p.archived_at IS NULL
    AND p.login_disabled = false
    AND (
      a.id IS NOT NULL
      OR (
        CASE
          WHEN v_search IS NOT NULL THEN
            p.display_name ILIKE '%' || v_search || '%'
            OR p.email ILIKE '%' || v_search || '%'
            OR public.get_user_role(p.user_id)::text ILIKE '%' || v_search || '%'
          ELSE
            public.get_user_role(p.user_id) = 'librarian'::public.app_role
        END
      )
    )
  ORDER BY (a.id IS NOT NULL) DESC, p.display_name NULLS LAST
  LIMIT greatest(_limit, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.library_access_matrix(uuid, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.library_access_matrix(uuid, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.library_access_matrix(uuid, text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
