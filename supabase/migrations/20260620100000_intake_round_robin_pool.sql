-- Intake round-robin pool for incoming-voice-call + WhatsApp lead distribution.
--
-- Reuses the existing (previously orphan) lead_allocation_rules table:
--   • A rule flagged is_intake_pool=true with assignment_type='round_robin'
--     defines the SEPARATE, admin-editable pool of counsellors that fresh
--     leads arriving by inbound voice call / WhatsApp message are distributed
--     across. Edited from the Lead Allocation admin page.
--
-- round_robin_pool stores profiles.user_id values (the admin picker lists
-- counsellors by user_id), whereas leads.counsellor_id references profiles.id —
-- so the assignment function maps user_id → profiles.id.
--
-- "Live" counsellor = profiles.last_seen_at within the last 2 minutes
-- (same heartbeat window used elsewhere, see 20260530120000_presence_heartbeat).
-- The function prefers online counsellors and falls back to the whole pool when
-- none are online (e.g. after business hours).

-- ─── Flag column ───────────────────────────────────────────────────────
ALTER TABLE public.lead_allocation_rules
  ADD COLUMN IF NOT EXISTS is_intake_pool boolean NOT NULL DEFAULT false;

-- At most one active intake pool — keeps the routing decision unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_allocation_rules_active_intake_pool
  ON public.lead_allocation_rules ((true))
  WHERE is_intake_pool AND is_active;

-- ─── Assignment function ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_intake_round_robin_assign(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Candidate counsellors = profiles whose user_id is in the pool.
  -- Prefer those currently online; if none are online, use the whole pool.
  -- "Load" = currently-pending follow-ups (mirrors fn_round_robin_assign_counsellor).
  WITH pool_profiles AS (
    SELECT p.id AS profile_id, p.user_id,
           (p.last_seen_at IS NOT NULL
              AND p.last_seen_at > now() - interval '2 minutes') AS is_online
    FROM public.profiles p
    WHERE p.user_id = ANY(v_pool)
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
$$;

GRANT EXECUTE ON FUNCTION public.fn_intake_round_robin_assign(uuid)
  TO authenticated, service_role;
