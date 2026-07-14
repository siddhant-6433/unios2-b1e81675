-- Fix live lead-transition RPCs that still cast classifyInactive to the
-- non-existent lead_stage value 'inactive'. Replacing the function is required
-- because the original migration may already be applied on Supabase projects.

CREATE OR REPLACE FUNCTION public.apply_lead_transition_command(
  _lead_id uuid,
  _command text,
  _target_stage public.lead_stage DEFAULT NULL,
  _reason text DEFAULT NULL,
  _extra_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(old_stage public.lead_stage, new_stage public.lead_stage)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_stage public.lead_stage;
  v_new_stage public.lead_stage;
  v_actor_profile_id uuid;
  v_description text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR 'leads:edit' = ANY(public.get_user_permissions(auth.uid()))
    OR 'leads:create' = ANY(public.get_user_permissions(auth.uid()))
  ) THEN
    RAISE EXCEPTION 'Not authorized to transition leads';
  END IF;

  SELECT stage INTO v_old_stage
  FROM public.leads
  WHERE id = _lead_id;

  IF v_old_stage IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  v_new_stage := CASE _command
    WHEN 'recordDispositionInterested' THEN 'counsellor_call'::public.lead_stage
    WHEN 'recordDispositionCallback' THEN 'counsellor_call'::public.lead_stage
    WHEN 'recordDispositionNotAnswered' THEN 'counsellor_call'::public.lead_stage
    WHEN 'recordDispositionNotInterested' THEN 'not_interested'::public.lead_stage
    WHEN 'recordDispositionDnc' THEN 'dnc'::public.lead_stage
    WHEN 'recordDispositionIneligible' THEN 'ineligible'::public.lead_stage
    WHEN 'recordDispositionDeferred' THEN 'deferred'::public.lead_stage
    WHEN 'scheduleVisit' THEN 'visit_scheduled'::public.lead_stage
    WHEN 'rescheduleVisit' THEN 'visit_scheduled'::public.lead_stage
    WHEN 'issueOffer' THEN 'offer_sent'::public.lead_stage
    WHEN 'markDnc' THEN 'dnc'::public.lead_stage
    WHEN 'restoreFromDnc' THEN 'new_lead'::public.lead_stage
    WHEN 'classifyLead' THEN 'new_lead'::public.lead_stage
    WHEN 'classifyNotInterested' THEN 'not_interested'::public.lead_stage
    WHEN 'classifyIneligible' THEN 'ineligible'::public.lead_stage
    WHEN 'classifyInactive' THEN 'cold'::public.lead_stage
    WHEN 'submitApplication' THEN 'application_submitted'::public.lead_stage
    WHEN 'approveApplication' THEN 'application_approved'::public.lead_stage
    WHEN 'recordInterviewPending' THEN 'interview'::public.lead_stage
    WHEN 'recordInterviewPassed' THEN 'offer_sent'::public.lead_stage
    WHEN 'recordInterviewFailed' THEN 'rejected'::public.lead_stage
    WHEN 'convertPreAdmitted' THEN 'pre_admitted'::public.lead_stage
    WHEN 'convertAdmitted' THEN 'admitted'::public.lead_stage
    WHEN 'adminOverrideStage' THEN _target_stage
    WHEN 'automationAdvanceStage' THEN _target_stage
    ELSE NULL
  END;

  IF v_new_stage IS NULL THEN
    RAISE EXCEPTION 'Unsupported lead transition command: %', _command;
  END IF;

  IF _command IN ('adminOverrideStage', 'automationAdvanceStage') AND (_target_stage IS NULL OR NULLIF(trim(_reason), '') IS NULL) THEN
    RAISE EXCEPTION 'Transition command % requires target stage and reason', _command;
  END IF;

  SELECT id INTO v_actor_profile_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  UPDATE public.leads
  SET
    stage = v_new_stage,
    updated_at = now(),
    person_role = COALESCE(_extra_patch->>'person_role', person_role),
    category_locked = COALESCE((_extra_patch->>'category_locked')::boolean, category_locked),
    offer_amount = COALESCE((_extra_patch->>'offer_amount')::numeric, offer_amount),
    future_eligible_session = COALESCE(_extra_patch->>'future_eligible_session', future_eligible_session),
    interview_score = COALESCE((_extra_patch->>'interview_score')::integer, interview_score),
    interview_result = COALESCE(
      CASE _extra_patch->>'interview_result'
        WHEN 'passed' THEN 'pass'
        WHEN 'failed' THEN 'reject'
        WHEN 'pending' THEN 'hold'
        ELSE _extra_patch->>'interview_result'
      END,
      interview_result
    ),
    pre_admission_no = COALESCE(_extra_patch->>'pre_admission_no', pre_admission_no),
    admission_no = COALESCE(_extra_patch->>'admission_no', admission_no)
  WHERE id = _lead_id;

  v_description := COALESCE(
    NULLIF(_reason, ''),
    CASE _command
      WHEN 'recordDispositionInterested' THEN 'Stage auto-advanced after interested call disposition'
      WHEN 'recordDispositionCallback' THEN 'Stage auto-advanced after callback call disposition'
      WHEN 'recordDispositionNotAnswered' THEN 'Stage auto-advanced after not answered call disposition'
      WHEN 'recordDispositionNotInterested' THEN 'Stage changed to Not Interested'
      WHEN 'recordDispositionDnc' THEN 'Stage changed to Do Not Contact'
      WHEN 'recordDispositionIneligible' THEN 'Stage changed to Ineligible'
      WHEN 'recordDispositionDeferred' THEN 'Stage changed to Deferred'
      WHEN 'markDnc' THEN 'Lead marked as Do Not Contact (DNC)'
      WHEN 'restoreFromDnc' THEN 'Lead removed from DNC list and moved back to New Lead'
      WHEN 'classifyInactive' THEN 'Stage changed to Cold after repeated inactive attempts'
      WHEN 'approveApplication' THEN 'Application approved'
      WHEN 'rescheduleVisit' THEN 'Stage changed to Visit Scheduled after visit reschedule'
      ELSE 'Lead transition command: ' || _command
    END
  );

  INSERT INTO public.lead_activities (
    lead_id,
    user_id,
    type,
    description,
    old_stage,
    new_stage
  ) VALUES (
    _lead_id,
    v_actor_profile_id,
    'stage_change',
    v_description,
    v_old_stage,
    v_new_stage
  );

  old_stage := v_old_stage;
  new_stage := v_new_stage;
  RETURN NEXT;
END;
$$;
