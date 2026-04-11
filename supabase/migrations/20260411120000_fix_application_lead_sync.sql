-- Fix orphaned applications: applications that don't have a linked lead
-- because the apply portal couldn't insert into leads table (RLS blocked
-- anonymous/applicant users). Creates/links leads and fixes the flow.

-- 1. SECURITY DEFINER function for the apply portal to create/link leads
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
BEGIN
  -- Normalize phone (add +91 if 10-digit)
  IF _phone IS NOT NULL AND length(regexp_replace(_phone, '\D', '', 'g')) = 10 THEN
    _phone := '+91' || regexp_replace(_phone, '\D', '', 'g');
  END IF;

  -- Check for existing lead by phone
  SELECT id INTO v_lead_id FROM public.leads WHERE phone = _phone LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    -- Existing lead — upgrade stage to application_in_progress if still in early stages
    UPDATE public.leads
    SET stage = CASE
          WHEN stage IN ('new_lead', 'ai_called', 'counsellor_call') THEN 'application_in_progress'::lead_stage
          ELSE stage
        END,
      application_id = COALESCE(application_id, _application_id),
      course_id = COALESCE(course_id, _course_id),
      campus_id = COALESCE(campus_id, _campus_id),
      email = COALESCE(email, _email),
      person_role = 'applicant',
      updated_at = now()
    WHERE id = v_lead_id;
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

GRANT EXECUTE ON FUNCTION public.upsert_application_lead TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_application_lead TO anon;
GRANT EXECUTE ON FUNCTION public.upsert_application_lead TO service_role;

-- 2. Backfill: create/link leads for orphaned applications
DO $$
DECLARE
  a RECORD;
  v_lead_id uuid;
  v_first_course uuid;
  v_first_campus uuid;
BEGIN
  FOR a IN
    SELECT id, application_id, full_name, phone, email, course_selections, program_category
    FROM public.applications
    WHERE lead_id IS NULL
      AND phone IS NOT NULL
      AND phone != ''
  LOOP
    -- Extract first course/campus from selections
    v_first_course := NULL;
    v_first_campus := NULL;
    IF jsonb_typeof(a.course_selections) = 'array' AND jsonb_array_length(a.course_selections) > 0 THEN
      BEGIN
        v_first_course := (a.course_selections->0->>'course_id')::uuid;
      EXCEPTION WHEN others THEN NULL;
      END;
      BEGIN
        v_first_campus := (a.course_selections->0->>'campus_id')::uuid;
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;

    -- Upsert the lead
    v_lead_id := public.upsert_application_lead(
      COALESCE(a.full_name, 'Applicant'),
      a.phone,
      a.email,
      v_first_course,
      v_first_campus,
      a.application_id,
      'website'
    );

    -- Link the application to the lead
    IF v_lead_id IS NOT NULL THEN
      UPDATE public.applications SET lead_id = v_lead_id WHERE id = a.id;
    END IF;
  END LOOP;
END $$;
