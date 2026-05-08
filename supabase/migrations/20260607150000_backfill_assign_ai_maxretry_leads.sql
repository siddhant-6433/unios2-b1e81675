-- Fix fn_round_robin_assign_counsellor: teams table has no campus_id column.
-- Remove campus scoping; instead pick the least-loaded counsellor system-wide.
CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counsellor_id uuid;
BEGIN
  -- Already assigned? Return existing.
  IF (SELECT counsellor_id FROM public.leads WHERE id = _lead_id) IS NOT NULL THEN
    RETURN (SELECT counsellor_id FROM public.leads WHERE id = _lead_id);
  END IF;

  -- Pick the least-loaded counsellor by pending followup count.
  WITH loads AS (
    SELECT p.id AS profile_id,
           COUNT(f.id) AS load
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'counsellor'
    LEFT JOIN public.lead_followups f ON f.user_id = p.user_id AND f.status = 'pending'
    GROUP BY p.id
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads
  ORDER BY load ASC, random()
  LIMIT 1;

  IF v_counsellor_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.leads SET counsellor_id = v_counsellor_id, updated_at = now()
  WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system', 'Auto-assigned to counsellor via round-robin (load-balanced).');

  RETURN v_counsellor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated, service_role;

-- Backfill: assign counsellors to leads that hit AI max 3 call attempts
-- but were left unassigned because the team lookup returned empty.
DO $$
DECLARE
  r          RECORD;
  v_assigned uuid;
  v_count    int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT l.id, l.stage::text AS stage
    FROM public.leads l
    WHERE l.counsellor_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.lead_followups f
        WHERE f.lead_id = l.id
          AND f.notes LIKE '%AI reached max 3%'
      )
  LOOP
    v_assigned := public.fn_round_robin_assign_counsellor(r.id);
    IF v_assigned IS NOT NULL AND r.stage = 'new_lead' THEN
      UPDATE public.leads SET stage = 'counsellor_call', updated_at = now() WHERE id = r.id;
    END IF;
    IF v_assigned IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Backfill complete: assigned counsellors to % leads', v_count;
END;
$$;
