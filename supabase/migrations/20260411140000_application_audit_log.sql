-- Audit log for application edits by staff (counsellors, admins, etc.)
-- Records every field change with old and new values for traceability.

CREATE TABLE public.application_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  section text NOT NULL,              -- 'personal', 'parents', 'academic', 'documents', etc.
  field_path text NOT NULL,           -- e.g. 'full_name', 'address.city', 'father.name'
  old_value jsonb,
  new_value jsonb,
  changed_by uuid REFERENCES auth.users(id),
  changed_by_name text,
  changed_by_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_application_audit_log_app ON public.application_audit_log(application_id, created_at DESC);
CREATE INDEX idx_application_audit_log_user ON public.application_audit_log(changed_by);

ALTER TABLE public.application_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view audit log" ON public.application_audit_log
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE POLICY "Staff can insert audit log" ON public.application_audit_log
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

GRANT SELECT, INSERT ON public.application_audit_log TO authenticated;
GRANT ALL ON public.application_audit_log TO service_role;

-- RPC: staff edits an application section with audit logging
-- Compares old vs new for each top-level key in _updates, logs diffs, applies update
CREATE OR REPLACE FUNCTION public.staff_update_application(
  _application_id uuid,
  _section text,
  _updates jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_user_role text;
  v_current applications%ROWTYPE;
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_changes int := 0;
BEGIN
  -- Verify staff role
  IF NOT (
    has_role(v_user_id, 'super_admin') OR
    has_role(v_user_id, 'campus_admin') OR
    has_role(v_user_id, 'principal') OR
    has_role(v_user_id, 'admission_head') OR
    has_role(v_user_id, 'counsellor')
  ) THEN
    RAISE EXCEPTION 'Only staff can edit applications';
  END IF;

  -- Load current application row
  SELECT * INTO v_current FROM applications WHERE id = _application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  -- Load user display name + role for the log
  SELECT display_name INTO v_user_name FROM profiles WHERE user_id = v_user_id;
  SELECT role::text INTO v_user_role FROM user_roles WHERE user_id = v_user_id LIMIT 1;

  -- Walk each top-level key in _updates and log diffs
  FOR v_key IN SELECT jsonb_object_keys(_updates) LOOP
    v_new := _updates -> v_key;

    -- Get old value from the row — use dynamic SQL for column lookup
    EXECUTE format('SELECT to_jsonb($1.%I)', v_key) USING v_current INTO v_old;

    -- Only log if there's an actual change
    IF v_old IS DISTINCT FROM v_new THEN
      INSERT INTO application_audit_log (
        application_id, section, field_path, old_value, new_value,
        changed_by, changed_by_name, changed_by_role
      ) VALUES (
        _application_id, _section, v_key, v_old, v_new,
        v_user_id, v_user_name, v_user_role
      );
      v_changes := v_changes + 1;
    END IF;
  END LOOP;

  -- Apply the update (bypasses RLS since SECURITY DEFINER)
  UPDATE applications
  SET
    full_name        = COALESCE((_updates->>'full_name'), full_name),
    dob              = CASE WHEN _updates ? 'dob' THEN NULLIF(_updates->>'dob', '')::date ELSE dob END,
    gender           = COALESCE((_updates->>'gender'), gender),
    nationality      = COALESCE((_updates->>'nationality'), nationality),
    category         = COALESCE((_updates->>'category'), category),
    email            = COALESCE((_updates->>'email'), email),
    aadhaar          = COALESCE((_updates->>'aadhaar'), aadhaar),
    apaar_id         = COALESCE((_updates->>'apaar_id'), apaar_id),
    pen_number       = COALESCE((_updates->>'pen_number'), pen_number),
    address          = CASE WHEN _updates ? 'address' THEN _updates->'address' ELSE address END,
    father           = CASE WHEN _updates ? 'father' THEN _updates->'father' ELSE father END,
    mother           = CASE WHEN _updates ? 'mother' THEN _updates->'mother' ELSE mother END,
    guardian         = CASE WHEN _updates ? 'guardian' THEN _updates->'guardian' ELSE guardian END,
    academic_details = CASE WHEN _updates ? 'academic_details' THEN _updates->'academic_details' ELSE academic_details END,
    result_status    = CASE WHEN _updates ? 'result_status' THEN _updates->'result_status' ELSE result_status END,
    extracurricular  = CASE WHEN _updates ? 'extracurricular' THEN _updates->'extracurricular' ELSE extracurricular END,
    school_details   = CASE WHEN _updates ? 'school_details' THEN _updates->'school_details' ELSE school_details END,
    completed_sections = CASE WHEN _updates ? 'completed_sections' THEN _updates->'completed_sections' ELSE completed_sections END,
    updated_at       = now()
  WHERE id = _application_id;

  -- Sync lead name if full_name changed
  IF _updates ? 'full_name' AND (_updates->>'full_name') IS NOT NULL AND (_updates->>'full_name') != '' THEN
    UPDATE leads SET name = (_updates->>'full_name'), updated_at = now()
    WHERE id = v_current.lead_id;
  END IF;

  RETURN jsonb_build_object('changes', v_changes, 'section', _section);
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_update_application TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_application TO service_role;
