-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260901140505 name=admin_force_logout_user_rpc applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
