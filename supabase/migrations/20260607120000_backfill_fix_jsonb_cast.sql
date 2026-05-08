-- ====================================================================
-- Fix: PL/pgSQL RECORD loses JSONB type info; add explicit ::jsonb casts
-- so ->> works on father/mother/guardian/address fields.
-- Also fixes text ->> unknown error from untyped string literals.
-- ====================================================================

DROP FUNCTION IF EXISTS public.backfill_student_from_application(uuid);

CREATE OR REPLACE FUNCTION public.backfill_student_from_application(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s            RECORD;
  v_app_id     uuid;
  v_app_status text;
  v_full_name  text;
  v_gender     text;
  v_dob        date;
  v_phone      text;
  v_email      text;
  v_nationality text;
  v_aadhaar    text;
  v_apaar_id   text;
  v_address    jsonb;
  v_father     jsonb;
  v_mother     jsonb;
  v_guardian   jsonb;
BEGIN
  SELECT id, lead_id INTO s
    FROM public.students
   WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found', p_student_id;
  END IF;

  IF s.lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'student has no lead_id — was this student created manually without a lead?');
  END IF;

  SELECT
    a.id, a.status,
    a.full_name, a.gender, a.dob, a.phone, a.email,
    a.nationality, a.aadhaar, a.apaar_id,
    a.address::jsonb, a.father::jsonb, a.mother::jsonb, a.guardian::jsonb
  INTO
    v_app_id, v_app_status,
    v_full_name, v_gender, v_dob, v_phone, v_email,
    v_nationality, v_aadhaar, v_apaar_id,
    v_address, v_father, v_mother, v_guardian
  FROM public.applications a
  WHERE a.lead_id = s.lead_id
  ORDER BY
    CASE a.status
      WHEN 'approved'     THEN 1
      WHEN 'submitted'    THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'no application found for lead_id ' || s.lead_id::text);
  END IF;

  UPDATE public.students SET
    name             = COALESCE(name,             NULLIF(v_full_name, '')),
    gender           = COALESCE(gender,           NULLIF(lower(v_gender), '')),
    dob              = COALESCE(dob,              v_dob),
    phone            = COALESCE(phone,            NULLIF(v_phone, '')),
    email            = COALESCE(email,            NULLIF(v_email, '')),
    nationality      = COALESCE(nationality,      NULLIF(v_nationality, '')),
    student_aadhar   = COALESCE(student_aadhar,   NULLIF(v_aadhaar, '')),
    apaar_id         = COALESCE(apaar_id,         NULLIF(v_apaar_id, '')),
    address          = COALESCE(address,          NULLIF(v_address->>'line1', '')),
    city             = COALESCE(city,             NULLIF(v_address->>'city', '')),
    state            = COALESCE(state,            NULLIF(v_address->>'state', '')),
    country          = COALESCE(country,          NULLIF(v_address->>'country', '')),
    pincode          = COALESCE(pincode,          NULLIF(v_address->>'pin_code', '')),
    father_name      = COALESCE(father_name,      NULLIF(COALESCE(
                         v_father->>'name',
                         NULLIF(concat_ws(' ', NULLIF(v_father->>'first_name',''), NULLIF(v_father->>'last_name','')), '')), '')),
    father_phone     = COALESCE(father_phone,     NULLIF(COALESCE(NULLIF(v_father->>'phone_mobile',''), v_father->>'phone'), '')),
    father_email     = COALESCE(father_email,     NULLIF(v_father->>'email', '')),
    father_occupation    = COALESCE(father_occupation,    NULLIF(v_father->>'occupation', '')),
    father_organization  = COALESCE(father_organization,  NULLIF(v_father->>'employer_name', '')),
    mother_name      = COALESCE(mother_name,      NULLIF(COALESCE(
                         v_mother->>'name',
                         NULLIF(concat_ws(' ', NULLIF(v_mother->>'first_name',''), NULLIF(v_mother->>'last_name','')), '')), '')),
    mother_phone     = COALESCE(mother_phone,     NULLIF(COALESCE(NULLIF(v_mother->>'phone_mobile',''), v_mother->>'phone'), '')),
    mother_email     = COALESCE(mother_email,     NULLIF(v_mother->>'email', '')),
    mother_occupation    = COALESCE(mother_occupation,    NULLIF(v_mother->>'occupation', '')),
    mother_organization  = COALESCE(mother_organization,  NULLIF(v_mother->>'employer_name', '')),
    guardian_name  = COALESCE(guardian_name,  NULLIF(v_guardian->>'name', '')),
    guardian_phone = COALESCE(guardian_phone, NULLIF(v_guardian->>'phone', ''))
  WHERE id = s.id;

  RETURN jsonb_build_object(
    'ok', true,
    'app_id', v_app_id,
    'app_status', v_app_status,
    'note', 'fields updated (COALESCE — existing data not overwritten)'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_student_from_application(uuid) TO authenticated, service_role;

-- Also fix the trigger function with typed variables
CREATE OR REPLACE FUNCTION public.fn_migrate_application_to_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name  text;
  v_gender     text;
  v_dob        date;
  v_phone      text;
  v_email      text;
  v_nationality text;
  v_aadhaar    text;
  v_apaar_id   text;
  v_address    jsonb;
  v_father     jsonb;
  v_mother     jsonb;
  v_guardian   jsonb;
BEGIN
  IF NEW.admission_no IS NULL OR OLD.admission_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    a.full_name, a.gender, a.dob, a.phone, a.email,
    a.nationality, a.aadhaar, a.apaar_id,
    a.address::jsonb, a.father::jsonb, a.mother::jsonb, a.guardian::jsonb
  INTO
    v_full_name, v_gender, v_dob, v_phone, v_email,
    v_nationality, v_aadhaar, v_apaar_id,
    v_address, v_father, v_mother, v_guardian
  FROM public.applications a
  WHERE a.lead_id = NEW.lead_id
  ORDER BY
    CASE a.status
      WHEN 'approved'     THEN 1
      WHEN 'submitted'    THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.students SET
    name             = COALESCE(name,             NULLIF(v_full_name, '')),
    gender           = COALESCE(gender,           NULLIF(lower(v_gender), '')),
    dob              = COALESCE(dob,              v_dob),
    phone            = COALESCE(phone,            NULLIF(v_phone, '')),
    email            = COALESCE(email,            NULLIF(v_email, '')),
    nationality      = COALESCE(nationality,      NULLIF(v_nationality, '')),
    student_aadhar   = COALESCE(student_aadhar,   NULLIF(v_aadhaar, '')),
    apaar_id         = COALESCE(apaar_id,         NULLIF(v_apaar_id, '')),
    address          = COALESCE(address,          NULLIF(v_address->>'line1', '')),
    city             = COALESCE(city,             NULLIF(v_address->>'city', '')),
    state            = COALESCE(state,            NULLIF(v_address->>'state', '')),
    country          = COALESCE(country,          NULLIF(v_address->>'country', '')),
    pincode          = COALESCE(pincode,          NULLIF(v_address->>'pin_code', '')),
    father_name      = COALESCE(father_name,      NULLIF(COALESCE(
                         v_father->>'name',
                         NULLIF(concat_ws(' ', NULLIF(v_father->>'first_name',''), NULLIF(v_father->>'last_name','')), '')), '')),
    father_phone     = COALESCE(father_phone,     NULLIF(COALESCE(NULLIF(v_father->>'phone_mobile',''), v_father->>'phone'), '')),
    father_email     = COALESCE(father_email,     NULLIF(v_father->>'email', '')),
    father_occupation    = COALESCE(father_occupation,    NULLIF(v_father->>'occupation', '')),
    father_organization  = COALESCE(father_organization,  NULLIF(v_father->>'employer_name', '')),
    mother_name      = COALESCE(mother_name,      NULLIF(COALESCE(
                         v_mother->>'name',
                         NULLIF(concat_ws(' ', NULLIF(v_mother->>'first_name',''), NULLIF(v_mother->>'last_name','')), '')), '')),
    mother_phone     = COALESCE(mother_phone,     NULLIF(COALESCE(NULLIF(v_mother->>'phone_mobile',''), v_mother->>'phone'), '')),
    mother_email     = COALESCE(mother_email,     NULLIF(v_mother->>'email', '')),
    mother_occupation    = COALESCE(mother_occupation,    NULLIF(v_mother->>'occupation', '')),
    mother_organization  = COALESCE(mother_organization,  NULLIF(v_mother->>'employer_name', '')),
    guardian_name  = COALESCE(guardian_name,  NULLIF(v_guardian->>'name', '')),
    guardian_phone = COALESCE(guardian_phone, NULLIF(v_guardian->>'phone', ''))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
