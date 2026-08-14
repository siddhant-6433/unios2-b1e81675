-- Departed staff: stop assigning them leads, and actually revoke their access.
--
-- Two problems that share a cause — nothing in this system agreed on what "this
-- person has left" means.
--
-- 1. Five separate re-implementations of "who can take a lead", with different
--    filters. fn_round_robin_assign_counsellor checks role + login_disabled +
--    archived_at; fn_intake_round_robin_assign (every inbound WhatsApp lead, and
--    Navya's counsellor handoff) checks NOTHING, selecting straight out of an
--    admin-curated array that nobody prunes when somebody leaves. This adds the
--    missing shared concept and points the divergent paths at it.
--
-- 2. Completing an exit sets profiles.login_disabled, which the auth layer does not
--    read. The real gate is auth.users.banned_until. Reconciling the two is the
--    sync-login-bans edge function; what belongs here is making the exit sweep
--    runnable on a schedule at all, and closing the hole that lets a user clear
--    their own disabled flag.

-- ── 1. One definition of an assignable counsellor ──────────────────────
CREATE OR REPLACE VIEW public.v_assignable_counsellors AS
  SELECT p.id AS profile_id,
         p.user_id,
         p.display_name
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'counsellor'::public.app_role
  WHERE COALESCE(p.login_disabled, false) = false
    AND p.archived_at IS NULL
    AND p.deleted_at IS NULL;

COMMENT ON VIEW public.v_assignable_counsellors IS
  'The single answer to "may this person receive a lead". Every automatic '
  'assignment path should select from here rather than re-deriving the predicate; '
  'they disagreed with each other before this existed.';

GRANT SELECT ON public.v_assignable_counsellors TO authenticated, service_role;

-- Liveness only, deliberately without the role check. Used to guard assignment
-- TARGETS, where tightening to role='counsellor' would reject the handful of leads
-- legitimately held by a consultant or a role-less profile.
CREATE OR REPLACE FUNCTION public.is_active_staff_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _profile_id
      AND COALESCE(p.login_disabled, false) = false
      AND p.archived_at IS NULL
      AND p.deleted_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_staff_profile(uuid) TO authenticated, service_role;

-- ── 2. Intake round robin: skip people who have left ───────────────────
-- Unchanged except for the candidate source. This is the path that fires on every
-- inbound WhatsApp message and on Navya's `request_counsellor` handoff, and it was
-- reading public.profiles with no filter of any kind.
CREATE OR REPLACE FUNCTION public.fn_intake_round_robin_assign(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead          public.leads%ROWTYPE;
  v_pool          uuid[];
  v_counsellor_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Already assigned? Leave the existing counsellor in place.
  IF v_lead.counsellor_id IS NOT NULL THEN
    RETURN v_lead.counsellor_id;
  END IF;

  -- The admin-maintained intake pool (single active flagged rule).
  SELECT round_robin_pool INTO v_pool
  FROM public.lead_allocation_rules
  WHERE is_active
    AND is_intake_pool
    AND assignment_type = 'round_robin'
    AND round_robin_pool IS NOT NULL
    AND array_length(round_robin_pool, 1) > 0
  ORDER BY priority ASC, created_at ASC
  LIMIT 1;

  IF v_pool IS NULL OR array_length(v_pool, 1) IS NULL THEN
    -- No pool configured → caller decides the fallback (AI agent for voice).
    RETURN NULL;
  END IF;

  -- Candidates = pool members who are still assignable. The pool array is not
  -- pruned when somebody leaves, so intersecting with the view is what stops a
  -- departed counsellor collecting inbound leads forever.
  -- Prefer those currently online; if none are online, use the whole pool.
  -- "Load" = currently-pending follow-ups (mirrors fn_round_robin_assign_counsellor).
  WITH pool_profiles AS (
    SELECT ac.profile_id, ac.user_id,
           (p.last_seen_at IS NOT NULL
              AND p.last_seen_at > now() - interval '2 minutes') AS is_online
    FROM public.v_assignable_counsellors ac
    JOIN public.profiles p ON p.id = ac.profile_id
    WHERE ac.user_id = ANY(v_pool)
  ),
  scoped AS (
    SELECT pp.*
    FROM pool_profiles pp
    WHERE pp.is_online
       OR NOT EXISTS (SELECT 1 FROM pool_profiles WHERE is_online)
  ),
  loads AS (
    SELECT s.profile_id, s.user_id,
           COALESCE((
             SELECT COUNT(*) FROM public.lead_followups f
             WHERE f.user_id = s.user_id AND f.status = 'pending'
           ), 0) AS load
    FROM scoped s
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads
  ORDER BY load ASC, random()
  LIMIT 1;

  IF v_counsellor_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
  SET counsellor_id = v_counsellor_id, updated_at = now()
  WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system',
          'Auto-assigned via intake round-robin pool (inbound voice / WhatsApp).');

  RETURN v_counsellor_id;
END;
$function$;

-- ── 3. claim_leads: validate the target ────────────────────────────────
-- Backstop for every UI dropdown. Six of them list counsellors without filtering
-- on login_disabled, so without a check here a departed person stays pickable and
-- bulk assignment happily hands them thousands of leads.
CREATE OR REPLACE FUNCTION public.claim_leads(_lead_ids uuid[], _assign_to uuid)
RETURNS TABLE(assigned_count integer, failed_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_counsellor boolean;
  v_assigned int := 0;
  v_failed int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _assign_to IS NULL THEN
    RAISE EXCEPTION 'Target counsellor is required';
  END IF;

  -- Liveness, not role: a few leads are legitimately held by a consultant and by
  -- role-less profiles, so this rejects people who have LEFT, nothing else.
  IF NOT public.is_active_staff_profile(_assign_to) THEN
    RAISE EXCEPTION 'That person has left the organisation and cannot be assigned leads';
  END IF;

  v_is_admin := has_role(v_caller_id, 'super_admin')
                OR has_role(v_caller_id, 'campus_admin')
                OR has_role(v_caller_id, 'admission_head')
                OR has_role(v_caller_id, 'principal');
  v_is_counsellor := has_role(v_caller_id, 'counsellor');

  IF NOT (v_is_admin OR v_is_counsellor) THEN
    RAISE EXCEPTION 'Insufficient permissions to claim leads';
  END IF;

  SELECT id INTO v_caller_profile_id
  FROM public.profiles
  WHERE user_id = v_caller_id;

  IF v_is_counsellor AND NOT v_is_admin THEN
    IF _assign_to IS DISTINCT FROM v_caller_profile_id THEN
      RAISE EXCEPTION 'Counsellors can only self-assign leads';
    END IF;
  END IF;

  WITH bucket_rows AS (
    SELECT
      ub.id,
      CASE
        WHEN ub.bucket = 'college' THEN 'College Leads'
        WHEN ub.school_brand = 'mirai' THEN 'Mirai IB Leads'
        WHEN ub.bucket = 'school' THEN 'CBSE School Leads'
        ELSE NULL
      END AS bucket_name
    FROM public.get_unassigned_leads_bucket() ub
    WHERE ub.id = ANY(_lead_ids)
  ),
  candidates AS (
    SELECT
      l.id,
      l.counsellor_id AS previous_counsellor_id,
      l.stage AS lead_stage_at_assignment,
      br.bucket_name
    FROM public.leads l
    LEFT JOIN bucket_rows br ON br.id = l.id
    WHERE l.id = ANY(_lead_ids)
      AND (v_is_admin OR l.counsellor_id IS NULL)
      AND l.counsellor_id IS DISTINCT FROM _assign_to
  ),
  updated AS (
    UPDATE public.leads l
    SET counsellor_id = _assign_to
    FROM candidates c
    WHERE l.id = c.id
    RETURNING l.id
  ),
  history_insert AS (
    INSERT INTO public.lead_assignment_history (
      lead_id,
      assigned_to,
      previous_counsellor_id,
      assigned_by_profile_id,
      assigned_by_user_id,
      assignment_source,
      bucket_name,
      lead_stage_at_assignment
    )
    SELECT
      c.id,
      _assign_to,
      c.previous_counsellor_id,
      v_caller_profile_id,
      v_caller_id,
      CASE
        WHEN NOT v_is_admin
          AND c.previous_counsellor_id IS NULL
          AND _assign_to = v_caller_profile_id
        THEN 'self_picked'
        ELSE 'assigned'
      END,
      c.bucket_name,
      c.lead_stage_at_assignment
    FROM candidates c
    JOIN updated u ON u.id = c.id
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_assigned FROM history_insert;

  v_failed := COALESCE(array_length(_lead_ids, 1), 0) - v_assigned;

  RETURN QUERY SELECT v_assigned, v_failed;
END;
$function$;

-- ── 4. The exit sweep, runnable on a schedule ──────────────────────────
-- The existing close_due_employee_exits() opens with a has_permission(auth.uid())
-- check. Under pg_cron auth.uid() is NULL, so scheduling it as-is would raise
-- 'Forbidden' every single run. Split the work out, leave the gate on the wrapper
-- the UI button calls.
CREATE OR REPLACE FUNCTION public.close_due_employee_exits_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer := 0;
BEGIN
  -- Notice served: the day has arrived, so complete the exit. The
  -- employee_exits_sync trigger does the rest (date_of_exit, employment_status,
  -- archived_at, login_disabled).
  UPDATE public.employee_exits
     SET status = 'completed', updated_at = now()
   WHERE status = 'in_progress'
     AND last_working_day IS NOT NULL
     AND last_working_day <= CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Completed early. sync_employee_exit() only revokes when the last working day
  -- has already passed AT THE MOMENT the status flips, so an exit completed ahead
  -- of the date never disabled anybody and nothing revisited it. Catch those up.
  UPDATE public.profiles p
     SET archived_at = COALESCE(p.archived_at, now()),
         login_disabled = true
    FROM public.employee_exits x
    JOIN public.employee_profiles ep ON ep.id = x.employee_profile_id
   WHERE p.user_id = ep.user_id
     AND x.status = 'completed'
     AND x.last_working_day IS NOT NULL
     AND x.last_working_day <= CURRENT_DATE
     AND COALESCE(p.login_disabled, false) = false;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.close_due_employee_exits_internal() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_due_employee_exits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN public.close_due_employee_exits_internal();
END;
$$;

-- Keka's "Exited employees" bucket is defined by the date passing, not by somebody
-- remembering to click. Pure SQL, following fn_cold_lead_cycle's precedent — no
-- pg_net and no service key, so there is nothing here that can drift out of sync.
SELECT cron.unschedule('close-due-employee-exits')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-due-employee-exits');

SELECT cron.schedule(
  'close-due-employee-exits',
  '20 1 * * *',
  $$SELECT public.close_due_employee_exits_internal()$$
);

-- ── 5. Stop a user clearing their own disabled flag ────────────────────
-- profiles RLS allows UPDATE USING (auth.uid() = user_id) with NO WITH CHECK, so
-- once login_disabled drives an auth ban, anyone with a live session could switch
-- it back off.
--
-- `REVOKE UPDATE (login_disabled)` does not work here and was tried first: a
-- table-level UPDATE grant already covers every column, so revoking the column
-- privilege changes nothing. A trigger is also the version that survives someone
-- adding a column to profiles later.
--
-- SECURITY INVOKER matters. Inside a SECURITY DEFINER function `current_user` is
-- the function owner, so a definer version of this guard would compare against the
-- wrong role and block nothing. As invoker, `current_user` is `authenticated` for a
-- browser session and the owner for toggle-user-login, delete-user,
-- sync_employee_exit and the transfer RPCs — which must all keep working.
CREATE OR REPLACE FUNCTION public.guard_login_disabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.login_disabled IS DISTINCT FROM OLD.login_disabled
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'login_disabled is set by HR tooling, not by editing your own profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_login_disabled ON public.profiles;
CREATE TRIGGER profiles_guard_login_disabled
  BEFORE UPDATE OF login_disabled ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_disabled();
