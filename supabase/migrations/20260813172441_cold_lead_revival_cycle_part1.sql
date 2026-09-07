-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260813172441 name=cold_lead_revival_cycle_part1 applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Cold lead revival cycle (part 1 of 2): cancel-trigger exemption, cycle start
-- trigger, and the disposition RPC carve-out. See migration
-- 20260813171448_cold_lead_revival_cycle.sql for the full commentary.

CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_terminal_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    UPDATE public.lead_followups
    SET status = 'cancelled',
        completed_at = now()
    WHERE lead_id = NEW.id
      AND status = 'pending'
      AND type <> 'cold_followup';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_start_cold_followup_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Idempotent: a lead bouncing back into cold keeps its open revival round.
  IF EXISTS (
    SELECT 1 FROM public.lead_followups
     WHERE lead_id = NEW.id AND type = 'cold_followup' AND status = 'pending'
  ) THEN
    RETURN NEW;
  END IF;

  -- lead_followups.user_id references auth.users; leads.counsellor_id is a
  -- profiles.id, hence the join. ai-call-failed-handler sets stage='cold' and
  -- counsellor_id=NULL in the same UPDATE, so fall back to OLD.
  SELECT p.user_id INTO v_user_id
    FROM public.profiles p
   WHERE p.id = COALESCE(NEW.counsellor_id, OLD.counsellor_id);

  INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
  VALUES (
    NEW.id, v_user_id, now() + interval '15 days', 'cold_followup',
    'Cold revival follow-up 1 of 2', 'pending'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_cold_followup_cycle ON public.leads;
CREATE TRIGGER trg_start_cold_followup_cycle
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (NEW.stage = 'cold' AND OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.fn_start_cold_followup_cycle();

CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid               text,
  p_lead_id                 uuid,
  p_user_id                 uuid,
  p_profile_id              uuid,
  p_disposition             text,
  p_duration                integer,
  p_call_notes              text,
  p_call_source             text,
  p_call_activity_desc      text,
  p_old_stage               text,
  p_new_stage               text,
  p_stage_activity_desc     text,
  p_future_eligible_session text,
  p_cnet_appeared           boolean,
  p_cahet_registered        boolean,
  p_followup_at             timestamptz,
  p_followup_notes          text,
  p_followup_activity_desc  text,
  p_requested_course_text   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_call_log_id uuid;
  v_uid uuid := (SELECT auth.uid());
  v_should_clear_followups boolean := true;
  v_rescheduled_count integer := 0;
BEGIN
  IF p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_lead_id is required';
  END IF;

  IF v_uid IS NULL OR NOT can_view_lead(v_uid, p_lead_id) THEN
    RAISE EXCEPTION 'not authorized for lead %', p_lead_id USING ERRCODE = '42501';
  END IF;

  v_call_log_id := record_cloud_call_log(
    p_call_uuid, p_lead_id, p_user_id, p_disposition, p_duration,
    p_call_notes, 'manual', NULL, p_call_source
  );

  IF p_requested_course_text IS NOT NULL THEN
    UPDATE public.call_logs
       SET requested_course_text = p_requested_course_text
     WHERE id = v_call_log_id;
  END IF;

  v_should_clear_followups := p_disposition <> 'not_answered';

  IF v_should_clear_followups THEN
    UPDATE public.lead_followups
       SET status = 'completed', completed_at = now()
     WHERE lead_id = p_lead_id
       AND status  = 'pending';
  ELSE
    -- A revival round the counsellor just worked is spent either way.
    UPDATE public.lead_followups
       SET status = 'completed', completed_at = now()
     WHERE lead_id = p_lead_id
       AND status  = 'pending'
       AND type    = 'cold_followup';

    IF p_followup_at IS NOT NULL THEN
      UPDATE public.lead_followups
         SET scheduled_at = p_followup_at,
             notes = COALESCE(p_followup_notes, notes)
       WHERE lead_id = p_lead_id
         AND status  = 'pending'
         AND type    <> 'cold_followup';
      GET DIAGNOSTICS v_rescheduled_count = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, p_profile_id, 'call', p_call_activity_desc);

  IF p_cnet_appeared IS NOT NULL THEN
    UPDATE public.leads
       SET cnet_appeared = p_cnet_appeared,
           updated_at = now()
     WHERE id = p_lead_id;
  END IF;

  IF p_cahet_registered IS NOT NULL THEN
    UPDATE public.leads
       SET cahet_registered = p_cahet_registered,
           updated_at = now()
     WHERE id = p_lead_id;
  END IF;

  IF p_new_stage IS NOT NULL THEN
    UPDATE public.leads
       SET stage = p_new_stage::lead_stage,
           future_eligible_session = COALESCE(p_future_eligible_session, future_eligible_session)
     WHERE id = p_lead_id;

    INSERT INTO public.lead_activities (lead_id, user_id, type, description, old_stage, new_stage)
    VALUES (
      p_lead_id, p_profile_id, 'stage_change', p_stage_activity_desc,
      p_old_stage::lead_stage, p_new_stage::lead_stage
    );
  END IF;

  IF p_followup_at IS NOT NULL AND v_should_clear_followups THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
    VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', p_followup_activity_desc);
  ELSIF p_followup_at IS NOT NULL AND p_disposition = 'not_answered' THEN
    IF v_rescheduled_count = 0 THEN
      INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
      VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');
    END IF;

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', COALESCE(p_followup_activity_desc, 'Follow-up rescheduled after not answered'));
  END IF;

  RETURN v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid               text,
  p_lead_id                 uuid,
  p_user_id                 uuid,
  p_profile_id              uuid,
  p_disposition             text,
  p_duration                integer,
  p_call_notes              text,
  p_call_source             text,
  p_call_activity_desc      text,
  p_old_stage               text,
  p_new_stage               text,
  p_stage_activity_desc     text,
  p_future_eligible_session text,
  p_cnet_appeared           boolean,
  p_cahet_registered        boolean,
  p_followup_at             timestamptz,
  p_followup_notes          text,
  p_followup_activity_desc  text
) RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.record_disposition_writes(
    p_call_uuid, p_lead_id, p_user_id, p_profile_id, p_disposition, p_duration,
    p_call_notes, p_call_source, p_call_activity_desc, p_old_stage, p_new_stage,
    p_stage_activity_desc, p_future_eligible_session, p_cnet_appeared,
    p_cahet_registered, p_followup_at, p_followup_notes, p_followup_activity_desc,
    NULL::text
  );
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
