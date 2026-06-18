-- Record AI priority-interest assignments in the lead assignment history.
-- Older history only distinguished manual assignment from self-pickup, so
-- auto-routed high-intent AI leads showed as generic system assignments.

ALTER TABLE public.lead_assignment_history
  DROP CONSTRAINT IF EXISTS lead_assignment_history_assignment_source_check;

ALTER TABLE public.lead_assignment_history
  ADD CONSTRAINT lead_assignment_history_assignment_source_check
  CHECK (assignment_source IN ('self_picked', 'assigned', 'ai_priority'));

UPDATE public.lead_assignment_history h
SET assignment_source = 'ai_priority',
    bucket_name = COALESCE(h.bucket_name, 'AI Priority Interested')
FROM public.leads l
WHERE l.id = h.lead_id
  AND l.stage = 'priority_interested'::public.lead_stage
  AND h.assignment_source = 'assigned'
  AND h.assigned_by_profile_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.lead_activities la
    WHERE la.lead_id = h.lead_id
      AND la.type = 'system'
      AND (
        la.description ILIKE '%Priority interested lead auto-assigned%'
        OR la.description ILIKE '%after AI call%'
      )
  );

UPDATE public.lead_assignment_history
SET assignment_source = 'ai_priority'
WHERE assignment_source = 'assigned'
  AND assigned_by_profile_id IS NULL
  AND bucket_name = 'AI Priority Interested';

INSERT INTO public.lead_assignment_history (
  lead_id,
  assigned_to,
  previous_counsellor_id,
  assigned_by_profile_id,
  assigned_by_user_id,
  assignment_source,
  bucket_name,
  lead_stage_at_assignment,
  created_at
)
SELECT
  l.id,
  l.counsellor_id,
  NULL,
  NULL,
  NULL,
  'ai_priority',
  'AI Priority Interested',
  'priority_interested'::public.lead_stage,
  COALESCE(l.assigned_at, l.updated_at, l.created_at)
FROM public.leads l
WHERE l.counsellor_id IS NOT NULL
  AND l.stage = 'priority_interested'::public.lead_stage
  AND EXISTS (
    SELECT 1
    FROM public.lead_activities la
    WHERE la.lead_id = l.id
      AND la.type = 'system'
      AND (
        la.description ILIKE '%Priority interested lead auto-assigned%'
        OR la.description ILIKE '%after AI call%'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.lead_assignment_history h
    WHERE h.lead_id = l.id
      AND h.assigned_to = l.counsellor_id
      AND h.assignment_source = 'ai_priority'
  );

-- Keep automatic assignment aligned with user management: archived or
-- login-disabled counsellors can remain visible in historic/team data, but
-- they must not receive new round-robin leads.
CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing       uuid;
  v_teams          text[];
  v_counsellor_id uuid;
BEGIN
  SELECT counsellor_id INTO v_existing FROM public.leads WHERE id = _lead_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_teams := public.fn_teams_for_lead(_lead_id);

  WITH eligible AS (
    SELECT DISTINCT p.id AS profile_id, p.user_id
    FROM public.teams t
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.profiles p      ON p.user_id  = tm.user_id
    JOIN public.user_roles ur   ON ur.user_id = p.user_id AND ur.role = 'counsellor'
    WHERE t.name = ANY(v_teams)
      AND COALESCE(p.login_disabled, false) = false
      AND p.archived_at IS NULL
  ),
  loads AS (
    SELECT e.profile_id,
           COALESCE((
             SELECT COUNT(*) FROM public.lead_followups f
             WHERE f.user_id = e.user_id AND f.status = 'pending'
           ), 0) AS load
    FROM eligible e
  )
  SELECT profile_id INTO v_counsellor_id
  FROM loads
  ORDER BY load ASC, random()
  LIMIT 1;

  IF v_counsellor_id IS NULL AND NOT ('Grn Counselling' = ANY(v_teams)) THEN
    WITH eligible AS (
      SELECT p.id AS profile_id, p.user_id
      FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      JOIN public.profiles p      ON p.user_id  = tm.user_id
      JOIN public.user_roles ur   ON ur.user_id = p.user_id AND ur.role = 'counsellor'
      WHERE t.name = 'Grn Counselling'
        AND COALESCE(p.login_disabled, false) = false
        AND p.archived_at IS NULL
    ),
    loads AS (
      SELECT e.profile_id,
             COALESCE((
               SELECT COUNT(*) FROM public.lead_followups f
               WHERE f.user_id = e.user_id AND f.status = 'pending'
             ), 0) AS load
      FROM eligible e
    )
    SELECT profile_id INTO v_counsellor_id
    FROM loads
    ORDER BY load ASC, random()
    LIMIT 1;
  END IF;

  IF v_counsellor_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
     SET counsellor_id = v_counsellor_id,
         updated_at    = now()
   WHERE id = _lead_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (_lead_id, 'system',
          format('Auto-assigned via round-robin (teams: %s)',
                 array_to_string(v_teams, ', ')));

  RETURN v_counsellor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_assign_priority_interested_lead(
  _lead_id uuid,
  _reason text DEFAULT 'priority_interested'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_assigned_to uuid;
  v_assigned_user_id uuid;
  v_assigned_name text;
  v_team_name text;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = _lead_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_lead.stage IS DISTINCT FROM 'priority_interested'::public.lead_stage THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_lead.person_role, 'lead') <> 'lead'
     OR v_lead.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    RETURN NULL;
  END IF;

  v_assigned_to := v_lead.counsellor_id;
  IF v_assigned_to IS NULL THEN
    v_assigned_to := public.fn_round_robin_assign_counsellor(_lead_id);
  END IF;

  IF v_assigned_to IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
  SET assigned_at = COALESCE(assigned_at, now()),
      updated_at = now()
  WHERE id = _lead_id;

  IF v_lead.counsellor_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_assignment_history h
       WHERE h.lead_id = _lead_id
         AND h.assigned_to = v_assigned_to
         AND h.assignment_source = 'ai_priority'
     ) THEN
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
    VALUES (
      _lead_id,
      v_assigned_to,
      NULL,
      NULL,
      NULL,
      'ai_priority',
      'AI Priority Interested',
      v_lead.stage
    );
  END IF;

  SELECT user_id, display_name
  INTO v_assigned_user_id, v_assigned_name
  FROM public.profiles
  WHERE id = v_assigned_to;

  v_team_name := array_to_string(public.fn_teams_for_lead(_lead_id), ', ');

  IF v_assigned_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_followups f
       WHERE f.lead_id = _lead_id
         AND f.type = 'call'
         AND f.status = 'pending'
     ) THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, status, notes)
    VALUES (
      _lead_id,
      v_assigned_user_id,
      now() + interval '30 minutes',
      'call',
      'pending',
      format('Priority interested lead auto-assigned to %s team. Reason: %s', COALESCE(v_team_name, 'admissions'), _reason)
    );
  END IF;

  IF v_assigned_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    VALUES (
      v_assigned_user_id,
      'lead_assigned',
      format('Priority interested lead assigned: %s', COALESCE(v_lead.name, 'Unknown')),
      'This lead is priority interested. Make first contact within 30 minutes.',
      '/admissions/' || _lead_id::text,
      _lead_id
    );
  END IF;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (
    _lead_id,
    'system',
    format(
      'Priority interested lead auto-assigned to %s (%s). Reason: %s',
      COALESCE(v_assigned_name, 'counsellor'),
      COALESCE(v_team_name, 'admissions'),
      _reason
    )
  );

  RETURN v_assigned_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_priority_interested_lead(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_assign_priority_interested_on_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'priority_interested'::public.lead_stage
     AND NEW.counsellor_id IS NULL THEN
    PERFORM public.fn_assign_priority_interested_lead(NEW.id, 'stage became priority_interested');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_priority_interested_on_stage ON public.leads;
CREATE TRIGGER trg_assign_priority_interested_on_stage
  AFTER INSERT OR UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (NEW.stage = 'priority_interested'::public.lead_stage AND NEW.counsellor_id IS NULL)
  EXECUTE FUNCTION public.fn_assign_priority_interested_on_stage();

CREATE OR REPLACE FUNCTION public.fn_auto_elevate_priority_interested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_disposition text := COALESCE(NEW.disposition, '');
  v_is_high_intent boolean := false;
  v_target_stage public.lead_stage;
  v_assigned_to uuid;
  v_assigned_user_id uuid;
  v_assigned_name text;
  v_team_name text;
BEGIN
  IF NEW.status <> 'completed' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = NEW.lead_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_disposition = 'not_interested'
     AND v_lead.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    UPDATE public.leads
    SET stage = 'not_interested'::public.lead_stage,
        updated_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (NEW.lead_id, 'ai_call', 'AI call disposition: not_interested -> lead marked not_interested');

    RETURN NEW;
  ELSIF v_disposition = 'wrong_number'
     AND v_lead.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    UPDATE public.leads
    SET stage = 'dnc'::public.lead_stage,
        updated_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (NEW.lead_id, 'ai_call', 'AI call disposition: wrong_number -> lead marked dnc');

    RETURN NEW;
  END IF;

  v_is_high_intent := v_disposition IN ('interested', 'callback_requested')
    OR COALESCE(NEW.conversion_probability, 0) >= 60;

  IF NOT v_is_high_intent THEN
    RETURN NEW;
  END IF;

  IF v_lead.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    RETURN NEW;
  END IF;

  v_assigned_to := public.fn_round_robin_assign_counsellor(NEW.lead_id);
  IF v_assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  v_target_stage := CASE
    WHEN COALESCE(NEW.conversion_probability, 0) >= 60 THEN 'priority_interested'::public.lead_stage
    ELSE 'counsellor_call'::public.lead_stage
  END;

  IF v_lead.stage IN ('new_lead', 'ai_called', 'counsellor_call', 'priority_interested', 'cold') THEN
    UPDATE public.leads
    SET stage = v_target_stage,
        assigned_at = COALESCE(assigned_at, now()),
        updated_at = now()
    WHERE id = NEW.lead_id;
  END IF;

  IF v_lead.counsellor_id IS NULL
     AND v_target_stage = 'priority_interested'::public.lead_stage
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_assignment_history h
       WHERE h.lead_id = NEW.lead_id
         AND h.assigned_to = v_assigned_to
         AND h.assignment_source = 'ai_priority'
     ) THEN
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
    VALUES (
      NEW.lead_id,
      v_assigned_to,
      NULL,
      NULL,
      NULL,
      'ai_priority',
      'AI Priority Interested',
      v_lead.stage
    );
  END IF;

  SELECT user_id, display_name
  INTO v_assigned_user_id, v_assigned_name
  FROM public.profiles
  WHERE id = v_assigned_to;

  v_team_name := array_to_string(public.fn_teams_for_lead(NEW.lead_id), ', ');

  IF v_assigned_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_followups f
       WHERE f.lead_id = NEW.lead_id
         AND f.type = 'call'
         AND f.status = 'pending'
     ) THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, status, notes)
    VALUES (
      NEW.lead_id,
      v_assigned_user_id,
      now() + interval '30 minutes',
      'call',
      'pending',
      format(
        'AI call outcome: %s. Auto-assigned to %s team.',
        COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent')),
        COALESCE(v_team_name, 'admissions')
      )
    );
  END IF;

  IF v_assigned_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    VALUES (
      v_assigned_user_id,
      'lead_assigned',
      format('New lead assigned: %s', COALESCE(v_lead.name, 'Unknown')),
      format(
        'AI call outcome: %s. Follow up within 30 minutes.',
        COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent'))
      ),
      '/admissions/' || NEW.lead_id::text,
      NEW.lead_id
    );
  END IF;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (
    NEW.lead_id,
    'system',
    format(
      'Auto-assigned to %s (%s) after AI call (%s)',
      COALESCE(v_assigned_name, 'counsellor'),
      COALESCE(v_team_name, 'admissions'),
      COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent'))
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_elevate_priority_interested ON public.ai_call_records;
CREATE TRIGGER trg_auto_elevate_priority_interested
  AFTER INSERT OR UPDATE OF status, disposition, conversion_probability ON public.ai_call_records
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_elevate_priority_interested();

-- One-time assignment pass for currently unassigned priority-interested leads.
-- The function uses fn_round_robin_assign_counsellor, which routes by the
-- teams returned from fn_teams_for_lead.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.leads
    WHERE stage = 'priority_interested'::public.lead_stage
      AND counsellor_id IS NULL
      AND is_mirror = false
      AND COALESCE(person_role, 'lead') = 'lead'
      AND stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted')
  LOOP
    PERFORM public.fn_assign_priority_interested_lead(r.id, 'one-time priority-interested assignment backfill');
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
