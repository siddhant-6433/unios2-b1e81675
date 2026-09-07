-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814154818 name=assignable_counsellors_and_exit_revocation applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE VIEW public.v_assignable_counsellors AS
  SELECT p.id AS profile_id, p.user_id, p.display_name
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id AND ur.role = 'counsellor'::public.app_role
  WHERE COALESCE(p.login_disabled, false) = false
    AND p.archived_at IS NULL
    AND p.deleted_at IS NULL;

COMMENT ON VIEW public.v_assignable_counsellors IS
  'The single answer to "may this person receive a lead". Every automatic assignment path should select from here rather than re-deriving the predicate; they disagreed with each other before this existed.';

GRANT SELECT ON public.v_assignable_counsellors TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_active_staff_profile(_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.fn_intake_round_robin_assign(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead          public.leads%ROWTYPE;
  v_pool          uuid[];
  v_counsellor_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_lead.counsellor_id IS NOT NULL THEN
    RETURN v_lead.counsellor_id;
  END IF;

  SELECT round_robin_pool INTO v_pool
  FROM public.lead_allocation_rules
  WHERE is_active AND is_intake_pool AND assignment_type = 'round_robin'
    AND round_robin_pool IS NOT NULL AND array_length(round_robin_pool, 1) > 0
  ORDER BY priority ASC, created_at ASC
  LIMIT 1;

  IF v_pool IS NULL OR array_length(v_pool, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  WITH pool_profiles AS (
    SELECT ac.profile_id, ac.user_id,
           (p.last_seen_at IS NOT NULL AND p.last_seen_at > now() - interval '2 minutes') AS is_online
    FROM public.v_assignable_counsellors ac
    JOIN public.profiles p ON p.id = ac.profile_id
    WHERE ac.user_id = ANY(v_pool)
  ),
  scoped AS (
    SELECT pp.* FROM pool_profiles pp
    WHERE pp.is_online OR NOT EXISTS (SELECT 1 FROM pool_profiles WHERE is_online)
  ),
  loads AS (
    SELECT s.profile_id, s.user_id,
           COALESCE((SELECT COUNT(*) FROM public.lead_followups f
                     WHERE f.user_id = s.user_id AND f.status = 'pending'), 0) AS load
    FROM scoped s
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads ORDER BY load ASC, random() LIMIT 1;

  IF v_counsellor_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.leads SET counsellor_id = v_counsellor_id, updated_at = now()
  WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system', 'Auto-assigned via intake round-robin pool (inbound voice / WhatsApp).');

  RETURN v_counsellor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_due_employee_exits_internal()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE public.employee_exits
     SET status = 'completed', updated_at = now()
   WHERE status = 'in_progress'
     AND last_working_day IS NOT NULL
     AND last_working_day <= CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

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
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN public.close_due_employee_exits_internal();
END;
$$;

REVOKE UPDATE (login_disabled) ON public.profiles FROM authenticated;
