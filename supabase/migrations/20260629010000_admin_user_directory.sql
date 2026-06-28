-- Authoritative Admin Panel user directory.
-- The client previously stitched profiles, user_roles, and auth metadata in the
-- browser. This RPC keeps that read model server-side so real staff profiles
-- such as counsellors cannot disappear because one side query is RLS-limited.

CREATE OR REPLACE FUNCTION public.admin_user_directory(_show_archived boolean DEFAULT false)
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  display_name text,
  email text,
  phone text,
  campus text,
  role public.app_role,
  role_id uuid,
  last_sign_in_at timestamptz,
  profile_updated_at timestamptz,
  login_disabled boolean,
  last_seen_at timestamptz,
  archived_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.id AS profile_id,
    p.display_name,
    p.email,
    p.phone,
    p.campus,
    ur.role,
    ur.id AS role_id,
    au.last_sign_in_at,
    p.updated_at AS profile_updated_at,
    COALESCE(p.login_disabled, false) AS login_disabled,
    p.last_seen_at,
    p.archived_at
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  WHERE p.deleted_at IS NULL
    AND (
      (_show_archived AND p.archived_at IS NOT NULL)
      OR (NOT _show_archived AND p.archived_at IS NULL)
    )
    AND (
      public.has_role(auth.uid(), 'super_admin'::public.app_role)
      OR 'user_management:view' = ANY(public.get_user_permissions(auth.uid()))
    )
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_directory(boolean) TO authenticated;
