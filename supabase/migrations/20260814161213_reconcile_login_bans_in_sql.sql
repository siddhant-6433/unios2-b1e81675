-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814161213 name=reconcile_login_bans_in_sql applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.reconcile_login_bans_internal()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  FOR v_row IN SELECT * FROM public.login_ban_drift() LOOP
    IF v_row.should_be_banned THEN
      UPDATE auth.users
         SET banned_until = now() + interval '876000 hours'
       WHERE id = v_row.user_id;
      PERFORM public.admin_revoke_user_sessions(v_row.user_id);
    ELSE
      UPDATE auth.users SET banned_until = NULL WHERE id = v_row.user_id;
    END IF;

    INSERT INTO public.user_admin_audit_log (
      target_user_id, target_display_name, action, details
    ) VALUES (
      v_row.user_id, v_row.display_name,
      CASE WHEN v_row.should_be_banned THEN 'login_disabled' ELSE 'login_enabled' END,
      jsonb_build_object('source', 'reconcile_login_bans_internal')
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_login_bans_internal() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reconcile_login_bans_internal() IS
  'Makes profiles.login_disabled real by moving auth.users.banned_until to match, and revoking sessions when banning. Scheduled directly so no API key is involved.';
