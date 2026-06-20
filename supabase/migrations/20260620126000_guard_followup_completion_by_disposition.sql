-- Follow-up rows must clear only after a real call disposition.
-- "not_answered" is not a completion: keep the existing follow-up pending and
-- move it to the next callback time supplied by the caller.

DROP TRIGGER IF EXISTS trg_followup_for_manual_no_answer ON public.ai_call_records;
DROP FUNCTION IF EXISTS public.ensure_followup_for_manual_no_answer();

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

  v_should_clear_followups := p_disposition <> 'not_answered';

  IF v_should_clear_followups THEN
    UPDATE public.lead_followups
       SET status = 'completed', completed_at = now()
     WHERE lead_id = p_lead_id
       AND status  = 'pending';
  ELSIF p_followup_at IS NOT NULL THEN
    UPDATE public.lead_followups
       SET scheduled_at = p_followup_at,
           notes = COALESCE(p_followup_notes, notes)
     WHERE lead_id = p_lead_id
       AND status  = 'pending';
    GET DIAGNOSTICS v_rescheduled_count = ROW_COUNT;
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
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO service_role;
NOTIFY pgrst, 'reload schema';
