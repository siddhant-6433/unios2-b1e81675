-- Manual Add Lead is a human-owned CRM entry point. Leads created through this
-- RPC must not be queued for AI voice calls, regardless of the selected source.

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
    cnet_appeared, cahet_registered, skip_ai_call, stage
  )
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    _source::lead_source,
    _course_id, _campus_id, _counsellor_id, _consultant_id,
    _cnet_appeared, _cahet_registered, true,
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
