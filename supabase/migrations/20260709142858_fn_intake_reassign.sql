-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260709142858 name=fn_intake_reassign applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.fn_intake_reassign(_lead_id uuid, _exclude_counsellor uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pool          uuid[];
  v_counsellor_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = _lead_id) THEN
    RETURN NULL;
  END IF;

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
    RETURN NULL;
  END IF;

  WITH pool_profiles AS (
    SELECT p.id AS profile_id, p.user_id,
           (p.last_seen_at IS NOT NULL
              AND p.last_seen_at > now() - interval '2 minutes') AS is_online
    FROM public.profiles p
    WHERE p.user_id = ANY(v_pool)
      AND p.id <> _exclude_counsellor
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
          'Auto-reassigned via intake pool — previous counsellor left WhatsApp unreplied past SLA.');

  RETURN v_counsellor_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_intake_reassign(uuid, uuid) TO service_role;
