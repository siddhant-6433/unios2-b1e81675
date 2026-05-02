-- RPC for adding leads from the UI (bypasses RLS SELECT restrictions on RETURNING)
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
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_phone text;
BEGIN
  -- Normalize phone
  v_phone := regexp_replace(_phone, '\D', '', 'g');
  IF length(v_phone) = 10 THEN
    v_phone := '+91' || v_phone;
  ELSIF length(v_phone) = 12 AND v_phone LIKE '91%' THEN
    v_phone := '+' || v_phone;
  ELSIF NOT v_phone LIKE '+%' THEN
    v_phone := '+' || v_phone;
  END IF;

  -- Check for duplicate phone
  SELECT id INTO v_lead_id FROM leads WHERE phone = v_phone LIMIT 1;
  IF v_lead_id IS NOT NULL THEN
    -- Update existing lead with new info if provided
    UPDATE leads SET
      name = COALESCE(NULLIF(_name, ''), name),
      email = COALESCE(NULLIF(_email, ''), email),
      guardian_name = COALESCE(NULLIF(_guardian_name, ''), guardian_name),
      guardian_phone = COALESCE(NULLIF(_guardian_phone, ''), guardian_phone),
      course_id = COALESCE(_course_id, course_id),
      campus_id = COALESCE(_campus_id, campus_id),
      counsellor_id = COALESCE(_counsellor_id, counsellor_id),
      updated_at = now()
    WHERE id = v_lead_id;
    RETURN v_lead_id;
  END IF;

  INSERT INTO leads (name, phone, email, guardian_name, guardian_phone, source, course_id, campus_id, counsellor_id, stage)
  VALUES (
    _name, v_phone, NULLIF(_email, ''),
    NULLIF(_guardian_name, ''), NULLIF(_guardian_phone, ''),
    _source::lead_source,
    _course_id, _campus_id, _counsellor_id,
    'new_lead'::lead_stage
  )
  RETURNING id INTO v_lead_id;

  -- Add note if provided
  IF _notes IS NOT NULL AND _notes != '' THEN
    INSERT INTO lead_notes (lead_id, content) VALUES (v_lead_id, _notes);
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_lead TO authenticated;
