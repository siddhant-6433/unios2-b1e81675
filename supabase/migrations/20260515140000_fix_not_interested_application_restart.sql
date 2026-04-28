-- Fix: Allow "not_interested" leads to restart their journey when they fill
-- the application form (candidate changed their mind), but block DNC leads.
-- Also log the stage change so counsellors can see WHY it changed.

CREATE OR REPLACE FUNCTION public.upsert_application_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _application_id text DEFAULT NULL,
  _source text DEFAULT 'website'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_old_stage text;
BEGIN
  -- Normalize phone (add +91 if 10-digit)
  IF _phone IS NOT NULL AND length(regexp_replace(_phone, '\D', '', 'g')) = 10 THEN
    _phone := '+91' || regexp_replace(_phone, '\D', '', 'g');
  END IF;

  -- Check for existing lead by phone
  SELECT id, stage::text INTO v_lead_id, v_old_stage FROM public.leads WHERE phone = _phone LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    -- Existing lead — upgrade stage to application_in_progress if in early or
    -- re-engageable stages. DNC/rejected/ineligible leads keep their stage.
    UPDATE public.leads
    SET stage = CASE
          WHEN stage IN ('new_lead', 'ai_called', 'counsellor_call', 'not_interested', 'deferred')
            THEN 'application_in_progress'::lead_stage
          ELSE stage
        END,
      application_id = COALESCE(application_id, _application_id),
      course_id = COALESCE(course_id, _course_id),
      campus_id = COALESCE(campus_id, _campus_id),
      email = COALESCE(email, _email),
      person_role = 'applicant',
      updated_at = now()
    WHERE id = v_lead_id;

    -- Log stage change if it actually changed (for counsellor visibility)
    IF v_old_stage IN ('not_interested', 'deferred') THEN
      INSERT INTO public.lead_activities (lead_id, type, description, old_stage, new_stage)
      VALUES (
        v_lead_id,
        'stage_change',
        'Candidate re-engaged: started filling application form on website',
        v_old_stage::lead_stage,
        'application_in_progress'::lead_stage
      );
    END IF;
  ELSE
    -- Create new lead
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, stage, person_role, application_id
    ) VALUES (
      COALESCE(NULLIF(_name, ''), 'Applicant'),
      _phone,
      _email,
      _course_id,
      _campus_id,
      _source::lead_source,
      'application_in_progress'::lead_stage,
      'applicant',
      _application_id
    )
    RETURNING id INTO v_lead_id;
  END IF;

  RETURN v_lead_id;
END;
$$;
