-- Fix: counsellors can't self-assign unassigned leads from the bucket because
-- the leads SELECT policy (via can_view_lead) only lets them see leads already
-- assigned to them. UPDATE runs through the same visibility check, so 0 rows
-- match the WHERE clause and the update silently affects 0 rows.
--
-- Solution: dedicated SECURITY DEFINER function that lets authorized staff
-- claim unassigned leads (or admins re-assign any lead) safely.

CREATE OR REPLACE FUNCTION public.claim_leads(
  _lead_ids uuid[],
  _assign_to uuid  -- profiles.id of the counsellor to assign to
)
RETURNS TABLE (
  assigned_count int,
  failed_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Determine caller role
  v_is_admin := has_role(v_caller_id, 'super_admin')
                OR has_role(v_caller_id, 'campus_admin')
                OR has_role(v_caller_id, 'admission_head')
                OR has_role(v_caller_id, 'principal');
  v_is_counsellor := has_role(v_caller_id, 'counsellor');

  IF NOT (v_is_admin OR v_is_counsellor) THEN
    RAISE EXCEPTION 'Insufficient permissions to claim leads';
  END IF;

  -- Look up caller's profile.id (used for counsellor self-assign check)
  SELECT id INTO v_caller_profile_id FROM profiles WHERE user_id = v_caller_id;

  -- Counsellors can only assign leads to themselves
  IF v_is_counsellor AND NOT v_is_admin THEN
    IF _assign_to IS DISTINCT FROM v_caller_profile_id THEN
      RAISE EXCEPTION 'Counsellors can only self-assign leads';
    END IF;
  END IF;

  -- For counsellors: only allow claiming leads that are currently unassigned
  -- For admins: allow re-assigning any lead
  IF v_is_admin THEN
    UPDATE leads
    SET counsellor_id = _assign_to
    WHERE id = ANY(_lead_ids);
    GET DIAGNOSTICS v_assigned = ROW_COUNT;
  ELSE
    UPDATE leads
    SET counsellor_id = _assign_to
    WHERE id = ANY(_lead_ids)
      AND counsellor_id IS NULL;
    GET DIAGNOSTICS v_assigned = ROW_COUNT;
  END IF;

  v_failed := COALESCE(array_length(_lead_ids, 1), 0) - v_assigned;

  RETURN QUERY SELECT v_assigned, v_failed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_leads TO authenticated;
