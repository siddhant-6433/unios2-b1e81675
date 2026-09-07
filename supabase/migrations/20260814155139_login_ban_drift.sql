-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814155139 name=login_ban_drift applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.login_ban_drift()
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  should_be_banned boolean,
  currently_banned boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.user_id,
         p.display_name,
         (COALESCE(p.login_disabled, false) OR p.deleted_at IS NOT NULL) AS should_be_banned,
         (u.banned_until IS NOT NULL AND u.banned_until > now())         AS currently_banned
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE (COALESCE(p.login_disabled, false) OR p.deleted_at IS NOT NULL)
        IS DISTINCT FROM (u.banned_until IS NOT NULL AND u.banned_until > now());
$$;

REVOKE ALL ON FUNCTION public.login_ban_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_ban_drift() TO service_role;

COMMENT ON FUNCTION public.login_ban_drift() IS
  'Rows where profiles.login_disabled/deleted_at disagrees with auth.users.banned_until. Drives the sync-login-bans function, which is what makes the HR flag actually revoke access.';

CREATE OR REPLACE FUNCTION public.is_login_blocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = _user_id
      AND (
        COALESCE(p.login_disabled, false)
        OR p.deleted_at IS NOT NULL
        OR (u.banned_until IS NOT NULL AND u.banned_until > now())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_login_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_login_blocked(uuid) TO service_role, authenticated;
