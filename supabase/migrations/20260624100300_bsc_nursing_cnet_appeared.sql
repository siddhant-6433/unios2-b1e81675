-- Capture entrance-status qualifiers for healthcare leads.
-- Nullable means "not yet asked / not applicable"; true/false are explicit
-- counsellor answers from Add Lead or call disposition.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS cnet_appeared boolean,
  ADD COLUMN IF NOT EXISTS cahet_registered boolean;

COMMENT ON COLUMN public.leads.cnet_appeared IS
  'For B.Sc Nursing leads: whether the candidate appeared for CNET. NULL means not captured or not applicable.';
COMMENT ON COLUMN public.leads.cahet_registered IS
  'For BPT/BMRIT leads: whether the candidate registered for CAHET. NULL means not captured or not applicable.';

DROP FUNCTION IF EXISTS public.insert_lead(text, text, text, text, text, text, uuid, uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.insert_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _guardian_name text DEFAULT NULL,
  _guardian_phone text DEFAULT NULL,
  _source text DEFAULT 'website',
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _counsellor_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _consultant_id uuid DEFAULT NULL,
  _cnet_appeared boolean DEFAULT NULL,
  _cahet_registered boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_phone text;
BEGIN
  v_phone := public.normalize_lead_phone(_phone);

  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE public.normalize_lead_phone(phone) = v_phone
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(_name, ''), name),
      email = COALESCE(NULLIF(_email, ''), email),
      guardian_name = COALESCE(NULLIF(_guardian_name, ''), guardian_name),
      guardian_phone = COALESCE(NULLIF(_guardian_phone, ''), guardian_phone),
      course_id = COALESCE(_course_id, course_id),
      campus_id = COALESCE(_campus_id, campus_id),
      counsellor_id = COALESCE(_counsellor_id, counsellor_id),
      cnet_appeared = COALESCE(_cnet_appeared, cnet_appeared),
      cahet_registered = COALESCE(_cahet_registered, cahet_registered),
      updated_at = now()
    WHERE id = v_lead_id;
    RETURN v_lead_id;
  END IF;

  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    source, course_id, campus_id, counsellor_id, consultant_id,
    cnet_appeared, cahet_registered, stage
  )
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    _source::lead_source,
    _course_id, _campus_id, _counsellor_id, _consultant_id,
    _cnet_appeared, _cahet_registered,
    'new_lead'::lead_stage
  )
  RETURNING id INTO v_lead_id;

  IF _notes IS NOT NULL AND _notes != '' THEN
    INSERT INTO public.lead_notes (lead_id, content) VALUES (v_lead_id, _notes);
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_lead TO authenticated;

DROP FUNCTION IF EXISTS public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, timestamptz, text, text
);

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
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_disposition_writes(
  text, uuid, uuid, uuid, text, integer, text, text, text, text, text, text, text, boolean, boolean, timestamptz, text, text
) TO service_role;
