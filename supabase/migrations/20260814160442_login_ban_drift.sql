-- Which accounts disagree with their profile about whether they may sign in.
--
-- profiles.login_disabled is what HR sets; auth.users.banned_until is what actually
-- stops a sign-in. Nothing kept them in step, so completing an exit marked somebody
-- as gone everywhere HR looks while leaving their login working.
--
-- This returns only the rows where the two disagree, so the reconciler applies a
-- handful of auth-admin calls instead of walking every user. That also sidesteps
-- auth.admin.listUsers(), which caps at 1000 per page and has already silently
-- missed the oldest accounts in this project once.
CREATE OR REPLACE FUNCTION public.login_ban_drift()
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  should_be_banned boolean,
  currently_banned boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.user_id,
         p.display_name,
         (COALESCE(p.login_disabled, false) OR p.deleted_at IS NOT NULL) AS should_be_banned,
         (u.banned_until IS NOT NULL AND u.banned_until > now())         AS currently_banned
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  -- An auth user that delete-user already soft-deleted cannot sign in, so banning it
  -- would be churn: an API call and an audit row every run for an account that is
  -- already gone. Only genuine drift belongs here.
  WHERE u.deleted_at IS NULL
    AND (COALESCE(p.login_disabled, false) OR p.deleted_at IS NOT NULL)
        IS DISTINCT FROM (u.banned_until IS NOT NULL AND u.banned_until > now());
$$;

-- Service role only: this reads auth.users and is not something a browser needs.
REVOKE ALL ON FUNCTION public.login_ban_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_ban_drift() TO service_role;

COMMENT ON FUNCTION public.login_ban_drift() IS
  'Rows where profiles.login_disabled/deleted_at disagrees with auth.users.banned_until. '
  'Drives the sync-login-bans function, which is what makes the HR flag actually revoke access.';

-- Is this account currently allowed to sign in? Used by the edge functions that mint
-- sessions with the service role (whatsapp-otp, student-password-login,
-- student-portal-claim, apply-portal-password-login). Those bypass GoTrue's own
-- grant, so a ban alone does not stop them — they have to ask.
CREATE OR REPLACE FUNCTION public.is_login_blocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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
