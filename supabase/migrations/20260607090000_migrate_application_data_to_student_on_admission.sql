-- ====================================================================
-- Auto-migrate application form data → student profile columns
-- when admission_no is first assigned (NULL → non-NULL).
--
-- Only fills NULL columns — never overwrites data already entered
-- directly in the student profile.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_migrate_application_to_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app RECORD;
BEGIN
  -- Only fires on the first assignment of admission_no.
  IF NEW.admission_no IS NULL OR OLD.admission_no IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Find the most recent submitted application for this student's lead.
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
  WHERE a.lead_id = NEW.lead_id
    AND a.status NOT IN ('draft')
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
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
    -- Address
    address          = COALESCE(address,          app.address->>'line1'),
    city             = COALESCE(city,             app.address->>'city'),
    state            = COALESCE(state,            app.address->>'state'),
    country          = COALESCE(country,          app.address->>'country'),
    pincode          = COALESCE(pincode,          app.address->>'pin_code'),
    -- Father
    father_name         = COALESCE(father_name,         app.father->>'name'),
    father_phone        = COALESCE(father_phone,        COALESCE(NULLIF(app.father->>'phone_mobile',''), app.father->>'phone')),
    father_email        = COALESCE(father_email,        app.father->>'email'),
    father_occupation   = COALESCE(father_occupation,   app.father->>'occupation'),
    father_organization = COALESCE(father_organization, app.father->>'employer_name'),
    -- Mother
    mother_name         = COALESCE(mother_name,         app.mother->>'name'),
    mother_phone        = COALESCE(mother_phone,        COALESCE(NULLIF(app.mother->>'phone_mobile',''), app.mother->>'phone')),
    mother_email        = COALESCE(mother_email,        app.mother->>'email'),
    mother_occupation   = COALESCE(mother_occupation,   app.mother->>'occupation'),
    mother_organization = COALESCE(mother_organization, app.mother->>'employer_name'),
    -- Guardian
    guardian_name  = COALESCE(guardian_name,  app.guardian->>'name'),
    guardian_phone = COALESCE(guardian_phone, app.guardian->>'phone')
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_migrate_application_to_student ON public.students;
CREATE TRIGGER trg_migrate_application_to_student
  AFTER UPDATE OF admission_no ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_migrate_application_to_student();
