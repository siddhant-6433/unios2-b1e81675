-- Reconcile the auth ban from SQL, so the schedule needs no key at all.
--
-- The first version of this ran the sync-login-bans edge function from pg_cron,
-- and it 403'd on the very first call: _app_config.service_role_key holds an
-- `sb_secret_…` key while the edge environment holds the legacy JWT, so the two
-- never matched. That is the third time key drift has silently killed a scheduled
-- job in this project, and chasing the key would have fixed it only until the next
-- rotation.
--
-- Banning does not actually need the auth admin API — auth.users.banned_until is a
-- column, and session revocation already has a SQL function that tolerates a NULL
-- auth.uid() for exactly this case. So the scheduled path is now pure SQL, like
-- close_due_employee_exits_internal and fn_cold_lead_cycle beside it: nothing to
-- authenticate, nothing to drift.
--
-- The edge function stays for the UI's "run it now" and as the manual entry point.

CREATE OR REPLACE FUNCTION public.reconcile_login_bans_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  FOR v_row IN SELECT * FROM public.login_ban_drift() LOOP
    IF v_row.should_be_banned THEN
      -- 100 years, matching PERMANENT_BAN in toggle-user-login.
      UPDATE auth.users
         SET banned_until = now() + interval '876000 hours'
       WHERE id = v_row.user_id;

      -- A ban leaves an already-issued access token valid until it expires, so
      -- somebody signed in keeps working for up to an hour without this.
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
  'Makes profiles.login_disabled real by moving auth.users.banned_until to match, and '
  'revoking sessions when banning. Scheduled directly so no API key is involved.';

-- auth.refresh_tokens.user_id is character varying, not uuid, so this has raised
-- 42883 on every call since it was written. Both callers log-and-continue
-- (toggle-user-login, delete-user), so disabling somebody banned them but never
-- revoked the session they already held — they kept working until the token expired.
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

  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _user_id;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
END;
$$;
