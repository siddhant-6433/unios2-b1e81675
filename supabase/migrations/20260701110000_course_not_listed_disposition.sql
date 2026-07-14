-- "Course Not Listed" call disposition: lead wants a course NIMT doesn't
-- offer. No follow-up is scheduled — the only thing worth persisting is
-- which course they asked for, so unmet-demand can be compiled later
-- (e.g. SELECT requested_course_text, count(*) FROM call_logs
--  WHERE disposition = 'course_not_listed' GROUP BY 1 ORDER BY 2 DESC).
--
-- disposition is a free-text column on call_logs (no CHECK constraint), so
-- the new value needs no enum/constraint change.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS requested_course_text text;

CREATE OR REPLACE FUNCTION public.record_disposition_writes(
  p_call_uuid text,
  p_lead_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_disposition text,
  p_duration integer,
  p_call_notes text,
  p_call_source text,
  p_call_activity_desc text,
  p_old_stage text,
  p_new_stage text,
  p_stage_activity_desc text,
  p_future_eligible_session text,
  p_cnet_appeared boolean,
  p_cahet_registered boolean,
  p_followup_at timestamp with time zone,
  p_followup_notes text,
  p_followup_activity_desc text,
  p_requested_course_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call_log_id uuid;
  v_uid uuid := (SELECT auth.uid());
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

  UPDATE public.lead_followups
     SET status = 'completed', completed_at = now()
   WHERE lead_id = p_lead_id
     AND status  = 'pending';

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

  IF p_followup_at IS NOT NULL THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
    VALUES (p_lead_id, p_user_id, p_followup_at, 'call', p_followup_notes, 'pending');

    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (p_lead_id, p_profile_id, 'followup', p_followup_activity_desc);
  END IF;

  RETURN v_call_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text,
  text, boolean, boolean, timestamp with time zone, text, text, text
) TO authenticated;
