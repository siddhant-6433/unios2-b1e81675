-- Standalone "force logout" for a user WITHOUT disabling their account.
-- Disabling already revokes sessions (toggle-user-login → admin_revoke_user_sessions);
-- this exposes the same kick-out on its own, and audits it server-side so the
-- record can't be skipped by the client.
--
-- Ceiling: this deletes refresh tokens (auth.sessions + auth.refresh_tokens), so
-- the user can't refresh — they're out within the access-token TTL (~1h), not the
-- same millisecond. An instant boundary needs per-request server checks (separate
-- feature). ponytail: token-revoke is the standard Supabase kick-out; good enough.

CREATE OR REPLACE FUNCTION public.admin_force_logout_user(_user_id uuid, _display_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can force logout a user';
  END IF;

  -- Reuse the existing kick-out primitive (deletes auth.sessions + refresh_tokens).
  PERFORM public.admin_revoke_user_sessions(_user_id);

  INSERT INTO public.user_admin_audit_log
    (target_user_id, target_display_name, action, details, performed_by, performed_by_name)
  VALUES (
    _user_id,
    _display_name,
    'force_logout',
    jsonb_build_object('via', 'admin_panel'),
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_logout_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_logout_user(uuid, text) TO authenticated;
