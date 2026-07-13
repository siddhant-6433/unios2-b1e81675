-- Mirror counsellor assignment events into lead_activities so the lead
-- timeline shows assign / reassign / unassign / bucket-pick history.
--
-- Assignment audit already lives in lead_assignment_history (claim_leads,
-- list RR, AI priority, etc.) but the timeline only reads lead_activities —
-- so picks and reassignments were invisible on the lead page.

------------------------------------------------------------------------
-- 0. Allow type = 'assignment' on lead_activities
------------------------------------------------------------------------
ALTER TABLE public.lead_activities
  DROP CONSTRAINT IF EXISTS lead_activities_type_check;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_type_check
  CHECK (type = ANY (ARRAY[
    'note'::text,
    'call'::text,
    'whatsapp'::text,
    'email'::text,
    'visit'::text,
    'visit_completed'::text,
    'status_change'::text,
    'stage_change'::text,
    'system'::text,
    'lead_created'::text,
    'ai_call'::text,
    'followup'::text,
    'offer'::text,
    'interview'::text,
    'conversion'::text,
    'application_progress'::text,
    'info_update'::text,
    'assignment'::text
  ]));

------------------------------------------------------------------------
-- 1. Helper: human-readable description from assignment history row
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_assignment_activity_description(
  _source text,
  _assigned_to_name text,
  _assigned_by_name text,
  _previous_name text,
  _bucket_name text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_to   text := COALESCE(NULLIF(trim(_assigned_to_name), ''), 'counsellor');
  v_by   text := NULLIF(trim(_assigned_by_name), '');
  v_prev text := NULLIF(trim(_previous_name), '');
  v_bkt  text := NULLIF(trim(_bucket_name), '');
BEGIN
  IF _source = 'self_picked' THEN
    IF v_bkt IS NOT NULL THEN
      RETURN format('Lead picked from %s by %s', v_bkt, v_to);
    END IF;
    RETURN format('Lead self-picked by %s', v_to);
  END IF;

  IF _source = 'ai_priority' THEN
    RETURN format('Lead auto-assigned to %s (AI priority)', v_to);
  END IF;

  IF _source = 'list_round_robin' THEN
    IF v_bkt IS NOT NULL THEN
      RETURN format('Lead assigned to %s from list “%s” (round-robin)', v_to, v_bkt);
    END IF;
    RETURN format('Lead assigned to %s (list round-robin)', v_to);
  END IF;

  -- Default: manual / bulk assign
  IF v_prev IS NOT NULL AND v_by IS NOT NULL THEN
    RETURN format('Lead reassigned from %s to %s by %s', v_prev, v_to, v_by);
  END IF;
  IF v_prev IS NOT NULL THEN
    RETURN format('Lead reassigned from %s to %s', v_prev, v_to);
  END IF;
  IF v_by IS NOT NULL AND v_by IS DISTINCT FROM v_to THEN
    RETURN format('Lead assigned to %s by %s', v_to, v_by);
  END IF;
  RETURN format('Lead assigned to %s', v_to);
END;
$$;

------------------------------------------------------------------------
-- 2. AFTER INSERT on lead_assignment_history → lead_activities
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_log_assignment_to_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_name   text;
  v_by_name   text;
  v_prev_name text;
  v_desc      text;
BEGIN
  SELECT display_name INTO v_to_name
  FROM public.profiles WHERE id = NEW.assigned_to;

  IF NEW.assigned_by_profile_id IS NOT NULL THEN
    SELECT display_name INTO v_by_name
    FROM public.profiles WHERE id = NEW.assigned_by_profile_id;
  END IF;

  IF NEW.previous_counsellor_id IS NOT NULL THEN
    SELECT display_name INTO v_prev_name
    FROM public.profiles WHERE id = NEW.previous_counsellor_id;
  END IF;

  v_desc := public.fn_assignment_activity_description(
    NEW.assignment_source,
    v_to_name,
    v_by_name,
    v_prev_name,
    NEW.bucket_name
  );

  -- Avoid near-duplicate if a caller already wrote an assignment activity.
  IF EXISTS (
    SELECT 1
    FROM public.lead_activities la
    WHERE la.lead_id = NEW.lead_id
      AND la.type = 'assignment'
      AND la.created_at >= now() - interval '15 seconds'
      AND la.description IS NOT DISTINCT FROM v_desc
  ) THEN
    RETURN NEW;
  END IF;

  -- lead_activities.user_id FKs to profiles(id), not auth.users.
  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (
    NEW.lead_id,
    NEW.assigned_by_profile_id,
    'assignment',
    v_desc
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_assignment_to_timeline ON public.lead_assignment_history;
CREATE TRIGGER trg_log_assignment_to_timeline
  AFTER INSERT ON public.lead_assignment_history
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_assignment_to_timeline();

------------------------------------------------------------------------
-- 3. Unassign (counsellor_id cleared) → lead_activities
--    History table requires assigned_to NOT NULL, so unassigns never land
--    there. Catch them on leads UPDATE.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_log_unassignment_to_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_name text;
  v_desc      text;
BEGIN
  IF NOT (OLD.counsellor_id IS NOT NULL AND NEW.counsellor_id IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO v_prev_name
  FROM public.profiles WHERE id = OLD.counsellor_id;

  v_desc := format(
    'Lead unassigned from %s (returned to bucket)',
    COALESCE(NULLIF(trim(v_prev_name), ''), 'previous counsellor')
  );

  -- SLA reclaim cron already inserts a richer system activity — skip duplicate.
  IF EXISTS (
    SELECT 1
    FROM public.lead_activities la
    WHERE la.lead_id = NEW.id
      AND la.created_at >= now() - interval '15 seconds'
      AND (
        la.type = 'assignment'
        OR (la.type = 'system' AND la.description ILIKE '%returned to bucket%')
      )
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (NEW.id, 'assignment', v_desc);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_unassignment_to_timeline ON public.leads;
CREATE TRIGGER trg_log_unassignment_to_timeline
  AFTER UPDATE OF counsellor_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_unassignment_to_timeline();

------------------------------------------------------------------------
-- 4. Backfill timeline from existing assignment history (idempotent)
------------------------------------------------------------------------
INSERT INTO public.lead_activities (lead_id, user_id, type, description, created_at)
SELECT
  h.lead_id,
  h.assigned_by_profile_id, -- profiles.id (lead_activities.user_id FK)
  'assignment',
  public.fn_assignment_activity_description(
    h.assignment_source,
    to_p.display_name,
    by_p.display_name,
    prev_p.display_name,
    h.bucket_name
  ),
  h.created_at
FROM public.lead_assignment_history h
LEFT JOIN public.profiles to_p   ON to_p.id = h.assigned_to
LEFT JOIN public.profiles by_p   ON by_p.id = h.assigned_by_profile_id
LEFT JOIN public.profiles prev_p ON prev_p.id = h.previous_counsellor_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lead_activities la
  WHERE la.lead_id = h.lead_id
    AND la.type = 'assignment'
    AND la.created_at BETWEEN h.created_at - interval '2 minutes' AND h.created_at + interval '2 minutes'
);

COMMENT ON FUNCTION public.fn_log_assignment_to_timeline() IS
  'Writes lead_activities rows for assignment history so the lead timeline shows picks/assigns/reassigns.';
COMMENT ON FUNCTION public.fn_log_unassignment_to_timeline() IS
  'Writes lead_activities when counsellor_id is cleared (return to bucket / unassign).';
