-- Disable-login feature for user management.
-- The actual sign-in gate is auth.users.banned_until (set by the
-- toggle-user-login edge function). This migration adds:
--   1. profiles.login_disabled — informational mirror flag for UI
--   2. user_admin_audit_log — audit trail for admin actions on user accounts
--   3. admin_revoke_user_sessions — SECURITY DEFINER helper to kick out
--      already-signed-in users by deleting their auth sessions/refresh tokens.

-- ── 1. Mirror flag on profiles ──────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_disabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_login_disabled
  ON public.profiles (login_disabled) WHERE login_disabled = true;

-- ── 2. Audit log for super_admin actions on user accounts ───────────
CREATE TABLE IF NOT EXISTS public.user_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  target_display_name text,
  action text NOT NULL,
  details jsonb,
  performed_by uuid REFERENCES auth.users(id),
  performed_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_admin_audit_log_target
  ON public.user_admin_audit_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_admin_audit_log_actor
  ON public.user_admin_audit_log (performed_by, created_at DESC);

ALTER TABLE public.user_admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin can view user admin audit" ON public.user_admin_audit_log;
CREATE POLICY "super_admin can view user admin audit"
  ON public.user_admin_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.user_admin_audit_log TO authenticated;
GRANT ALL ON public.user_admin_audit_log TO service_role;

-- ── 3. Revoke active sessions for a user (immediate kick-out) ───────
-- Allowed when caller is super_admin OR when called via service_role
-- (auth.uid() returns NULL in service_role context — already privileged).
CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can revoke user sessions';
  END IF;

  -- auth.sessions exists in newer Supabase Auth; tolerate missing table.
  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _user_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  DELETE FROM auth.refresh_tokens WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO service_role;
