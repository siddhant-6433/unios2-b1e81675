-- ====================================================================
-- Relax the draft filter in both migrate + backfill functions.
--
-- The original functions excluded status='draft' applications, which
-- caused the backfill to silently find nothing for candidates whose
-- applications were pushed through the admin pipeline without ever
-- reaching 'submitted' status in the portal.
--
-- Since we use COALESCE (never overwrite existing data), pulling from
-- a draft application is safe — partial data beats no data.
-- ====================================================================

-- 1. Update trigger function -----------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_migrate_application_to_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app RECORD;
BEGIN
  IF NEW.admission_no IS NULL OR OLD.admission_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    a.full_name, a.gender, a.dob, a.phone, a.email,
    a.nationality, a.aadhaar, a.apaar_id,
    a.address, a.father, a.mother, a.guardian
  INTO app
  FROM public.applications a
  WHERE a.lead_id = NEW.lead_id
  ORDER BY
    -- prefer submitted/approved over draft, but fall back to any
    CASE a.status
      WHEN 'approved'   THEN 1
      WHEN 'submitted'  THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.students SET
    name             = COALESCE(name,             NULLIF(app.full_name, '')),
    gender           = COALESCE(gender,           NULLIF(LOWER(app.gender), '')),
    dob              = COALESCE(dob,              app.dob),
    phone            = COALESCE(phone,            NULLIF(app.phone, '')),
    email            = COALESCE(email,            NULLIF(app.email, '')),
    nationality      = COALESCE(nationality,      NULLIF(app.nationality, '')),
    student_aadhar   = COALESCE(student_aadhar,   NULLIF(app.aadhaar, '')),
    apaar_id         = COALESCE(apaar_id,         NULLIF(app.apaar_id, '')),
    address          = COALESCE(address,          NULLIF(app.address->>'line1', '')),
    city             = COALESCE(city,             NULLIF(app.address->>'city', '')),
    state            = COALESCE(state,            NULLIF(app.address->>'state', '')),
    country          = COALESCE(country,          NULLIF(app.address->>'country', '')),
    pincode          = COALESCE(pincode,          NULLIF(app.address->>'pin_code', '')),
    father_name         = COALESCE(father_name,         NULLIF(COALESCE(app.father->>'name', app.father->>'first_name' || ' ' || app.father->>'last_name'), '')),
    father_phone        = COALESCE(father_phone,        NULLIF(COALESCE(NULLIF(app.father->>'phone_mobile',''), app.father->>'phone'), '')),
    father_email        = COALESCE(father_email,        NULLIF(app.father->>'email', '')),
    father_occupation   = COALESCE(father_occupation,   NULLIF(app.father->>'occupation', '')),
    father_organization = COALESCE(father_organization, NULLIF(app.father->>'employer_name', '')),
    mother_name         = COALESCE(mother_name,         NULLIF(COALESCE(app.mother->>'name', app.mother->>'first_name' || ' ' || app.mother->>'last_name'), '')),
    mother_phone        = COALESCE(mother_phone,        NULLIF(COALESCE(NULLIF(app.mother->>'phone_mobile',''), app.mother->>'phone'), '')),
    mother_email        = COALESCE(mother_email,        NULLIF(app.mother->>'email', '')),
    mother_occupation   = COALESCE(mother_occupation,   NULLIF(app.mother->>'occupation', '')),
    mother_organization = COALESCE(mother_organization, NULLIF(app.mother->>'employer_name', '')),
    guardian_name  = COALESCE(guardian_name,  NULLIF(app.guardian->>'name', '')),
    guardian_phone = COALESCE(guardian_phone, NULLIF(app.guardian->>'phone', ''))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- 2. Update on-demand backfill RPC -----------------------------------------
-- Drop first because return type changed void → jsonb.
DROP FUNCTION IF EXISTS public.backfill_student_from_application(uuid);
CREATE OR REPLACE FUNCTION public.backfill_student_from_application(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s   RECORD;
  app RECORD;
BEGIN
  SELECT id, lead_id INTO s
    FROM public.students
   WHERE id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found', p_student_id;
  END IF;

  IF s.lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'student has no lead_id — was this student created manually without a lead?');
  END IF;

  SELECT
    a.id AS app_id, a.status AS app_status,
    a.full_name, a.gender, a.dob, a.phone, a.email,
    a.nationality, a.aadhaar, a.apaar_id,
    a.address, a.father, a.mother, a.guardian
  INTO app
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
    RETURN jsonb_build_object('ok', false, 'reason', 'no application found for lead_id ' || s.lead_id);
  END IF;

  UPDATE public.students SET
    name             = COALESCE(name,             NULLIF(app.full_name, '')),
    gender           = COALESCE(gender,           NULLIF(LOWER(app.gender), '')),
    dob              = COALESCE(dob,              app.dob),
    phone            = COALESCE(phone,            NULLIF(app.phone, '')),
    email            = COALESCE(email,            NULLIF(app.email, '')),
    nationality      = COALESCE(nationality,      NULLIF(app.nationality, '')),
    student_aadhar   = COALESCE(student_aadhar,   NULLIF(app.aadhaar, '')),
    apaar_id         = COALESCE(apaar_id,         NULLIF(app.apaar_id, '')),
    address          = COALESCE(address,          NULLIF(app.address->>'line1', '')),
    city             = COALESCE(city,             NULLIF(app.address->>'city', '')),
    state            = COALESCE(state,            NULLIF(app.address->>'state', '')),
    country          = COALESCE(country,          NULLIF(app.address->>'country', '')),
    pincode          = COALESCE(pincode,          NULLIF(app.address->>'pin_code', '')),
    father_name         = COALESCE(father_name,         NULLIF(COALESCE(app.father->>'name', app.father->>'first_name' || ' ' || app.father->>'last_name'), '')),
    father_phone        = COALESCE(father_phone,        NULLIF(COALESCE(NULLIF(app.father->>'phone_mobile',''), app.father->>'phone'), '')),
    father_email        = COALESCE(father_email,        NULLIF(app.father->>'email', '')),
    father_occupation   = COALESCE(father_occupation,   NULLIF(app.father->>'occupation', '')),
    father_organization = COALESCE(father_organization, NULLIF(app.father->>'employer_name', '')),
    mother_name         = COALESCE(mother_name,         NULLIF(COALESCE(app.mother->>'name', app.mother->>'first_name' || ' ' || app.mother->>'last_name'), '')),
    mother_phone        = COALESCE(mother_phone,        NULLIF(COALESCE(NULLIF(app.mother->>'phone_mobile',''), app.mother->>'phone'), '')),
    mother_email        = COALESCE(mother_email,        NULLIF(app.mother->>'email', '')),
    mother_occupation   = COALESCE(mother_occupation,   NULLIF(app.mother->>'occupation', '')),
    mother_organization = COALESCE(mother_organization, NULLIF(app.mother->>'employer_name', '')),
    guardian_name  = COALESCE(guardian_name,  NULLIF(app.guardian->>'name', '')),
    guardian_phone = COALESCE(guardian_phone, NULLIF(app.guardian->>'phone', ''))
  WHERE id = s.id;

  RETURN jsonb_build_object(
    'ok', true,
    'app_id', app.app_id,
    'app_status', app.app_status,
    'note', 'fields updated (COALESCE — existing data not overwritten)'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_student_from_application(uuid) TO authenticated, service_role;

-- 3. Re-run one-time backfill for all admitted students --------------------
DO $$
DECLARE
  v_id  uuid;
  v_res jsonb;
BEGIN
  FOR v_id IN
    SELECT id FROM public.students WHERE admission_no IS NOT NULL
  LOOP
    BEGIN
      v_res := public.backfill_student_from_application(v_id);
      IF NOT (v_res->>'ok')::boolean THEN
        RAISE WARNING '[backfill] student %: %', v_id, v_res->>'reason';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[backfill] student % error: %', v_id, SQLERRM;
    END;
  END LOOP;
END$$;
