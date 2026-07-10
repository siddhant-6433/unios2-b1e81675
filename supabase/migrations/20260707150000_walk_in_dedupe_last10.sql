-- ====================================================================
-- Fix create_walk_in_visit phone dedupe: prod normalizes lead phones to
-- +91XXXXXXXXXX (unique index idx_leads_phone_unique), so a full-digit
-- comparison ('919888877777' vs '9888877777') misses and the subsequent
-- INSERT hits the unique constraint. Compare on the LAST 10 DIGITS, which
-- is invariant to the +91 normalization. Caught by ship-time verification
-- check 5 (scripts/verify-token-fee-and-consultant-fees.sql).
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_walk_in_visit(
  _name       text,
  _phone      text,
  _email      text        DEFAULT NULL,
  _course_id  uuid        DEFAULT NULL,
  _campus_id  uuid        DEFAULT NULL,
  _purpose    text        DEFAULT NULL,
  _notes      text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid;
  v_session_id  uuid;
  v_lead_id     uuid;
  v_visit_id    uuid;
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF v_clean_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  SELECT id INTO v_session_id FROM public.admission_sessions
   WHERE is_active = true ORDER BY start_date DESC LIMIT 1;

  -- Dedupe by LAST 10 digits: leads.phone is normalized to +91XXXXXXXXXX by
  -- trigger, so full-digit-string equality misses country-code variants.
  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE RIGHT(regexp_replace(phone, '\D', '', 'g'), 10) = RIGHT(v_clean_phone, 10)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, counsellor_id, session_id, notes
    ) VALUES (
      btrim(_name), _phone, NULLIF(btrim(COALESCE(_email, '')), ''),
      _course_id, _campus_id,
      'walk_in', v_profile_id, v_session_id, _notes
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Existing lead: keep counsellor, refresh contact context if empty.
    UPDATE public.leads
       SET email      = COALESCE(NULLIF(btrim(COALESCE(_email, '')), ''), email),
           course_id  = COALESCE(_course_id, course_id),
           campus_id  = COALESCE(_campus_id, campus_id)
     WHERE id = v_lead_id;
  END IF;

  INSERT INTO public.campus_visits (
    lead_id, campus_id, scheduled_by, visit_date, status,
    visit_type, checked_in_at, purpose, feedback
  ) VALUES (
    v_lead_id, COALESCE(_campus_id, (SELECT campus_id FROM public.leads WHERE id = v_lead_id)),
    auth.uid(), now(), 'completed',
    'walk_in', now(), _purpose, _notes
  )
  RETURNING id INTO v_visit_id;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (v_lead_id, v_profile_id, 'visit',
          'Walk-in recorded' || COALESCE(' — ' || _purpose, ''));

  RETURN jsonb_build_object('lead_id', v_lead_id, 'visit_id', v_visit_id);
END;
$$;
