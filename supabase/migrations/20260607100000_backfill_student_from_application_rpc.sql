-- ====================================================================
-- Reusable RPC: backfill_student_from_application(p_student_id)
--
-- Runs the same COALESCE logic as the trigger introduced in
-- 20260607090000 but is callable on-demand from the admin UI
-- for students admitted before the trigger existed.
--
-- A one-time DO block at the end backfills all currently-admitted
-- students whose profile columns are still NULL.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.backfill_student_from_application(p_student_id uuid)
RETURNS void
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
   WHERE id = p_student_id
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found', p_student_id;
  END IF;

  SELECT
    a.full_name,
    a.gender,
    a.dob,
    a.phone,
    a.email,
    a.nationality,
    a.aadhaar,
    a.apaar_id,
    a.address,
    a.father,
    a.mother,
    a.guardian
  INTO app
  FROM public.applications a
  WHERE a.lead_id = s.lead_id
    AND a.status NOT IN ('draft')
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN; -- no submitted application — nothing to copy
  END IF;

  UPDATE public.students SET
    name             = COALESCE(name,             app.full_name),
    gender           = COALESCE(gender,           LOWER(app.gender)),
    dob              = COALESCE(dob,              app.dob),
    phone            = COALESCE(phone,            app.phone),
    email            = COALESCE(email,            app.email),
    nationality      = COALESCE(nationality,      app.nationality),
    student_aadhar   = COALESCE(student_aadhar,   app.aadhaar),
    apaar_id         = COALESCE(apaar_id,         app.apaar_id),
    address          = COALESCE(address,          app.address->>'line1'),
    city             = COALESCE(city,             app.address->>'city'),
    state            = COALESCE(state,            app.address->>'state'),
    country          = COALESCE(country,          app.address->>'country'),
    pincode          = COALESCE(pincode,          app.address->>'pin_code'),
    father_name         = COALESCE(father_name,         app.father->>'name'),
    father_phone        = COALESCE(father_phone,        COALESCE(NULLIF(app.father->>'phone_mobile',''), app.father->>'phone')),
    father_email        = COALESCE(father_email,        app.father->>'email'),
    father_occupation   = COALESCE(father_occupation,   app.father->>'occupation'),
    father_organization = COALESCE(father_organization, app.father->>'employer_name'),
    mother_name         = COALESCE(mother_name,         app.mother->>'name'),
    mother_phone        = COALESCE(mother_phone,        COALESCE(NULLIF(app.mother->>'phone_mobile',''), app.mother->>'phone')),
    mother_email        = COALESCE(mother_email,        app.mother->>'email'),
    mother_occupation   = COALESCE(mother_occupation,   app.mother->>'occupation'),
    mother_organization = COALESCE(mother_organization, app.mother->>'employer_name'),
    guardian_name  = COALESCE(guardian_name,  app.guardian->>'name'),
    guardian_phone = COALESCE(guardian_phone, app.guardian->>'phone')
  WHERE id = s.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_student_from_application(uuid) TO authenticated, service_role;

-- One-time backfill for all admitted students (admission_no IS NOT NULL)
-- whose name is still NULL (proxy for "never been migrated").
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.students WHERE admission_no IS NOT NULL
  LOOP
    BEGIN
      PERFORM public.backfill_student_from_application(v_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[backfill] student % skipped: %', v_id, SQLERRM;
    END;
  END LOOP;
END$$;
