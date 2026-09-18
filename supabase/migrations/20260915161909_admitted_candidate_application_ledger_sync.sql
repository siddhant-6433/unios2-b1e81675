-- Admitted-candidate sync: counsellor, offer concessions, application documents.
--
-- NIMT School (Beacon) and Mirai are separate pipelines. Phone matching must
-- not attach a Beacon application to a Mirai lead (or the reverse).
-- 20260915133000_stop_beacon_mirai_lead_mirroring.sql drops the clone trigger
-- and lets the same phone exist once per school brand. This file still has to
-- be safe if leftover pairs exist.
--
-- Offer approval also never re-ran concession sync, and school provision skipped
-- sync when ledger rows already existed. Documents were never copied onto
-- student_documents at PAN/AN.

-- ── 1. Canonical CRM lead for an application ─────────────────────────────

CREATE OR REPLACE FUNCTION public.school_lead_brand(
  p_portal_brand text,
  p_campus_id uuid,
  p_institution_type text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_portal_brand, '')) = 'mirai' THEN 'mirai'
    WHEN p_campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid
     AND coalesce(p_institution_type, '') = 'school' THEN 'mirai'
    ELSE 'nimt'
  END
$$;

CREATE OR REPLACE FUNCTION public.canonical_application_lead_id(
  p_phone text,
  p_application_id text DEFAULT NULL,
  p_current_lead_id uuid DEFAULT NULL,
  p_campus_id uuid DEFAULT NULL,
  p_course_id uuid DEFAULT NULL,
  p_portal_brand text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_current_is_mirror boolean;
  v_current_campus uuid;
  v_current_type text;
  v_current_portal text;
  v_app_brand text;
  v_lead_id uuid;
BEGIN
  v_app_brand := public.school_lead_brand(
    p_portal_brand,
    p_campus_id,
    public.compute_lead_institution_type(p_course_id, p_campus_id, NULL)
  );

  IF p_current_lead_id IS NOT NULL THEN
    SELECT COALESCE(is_mirror, false), campus_id, lead_institution_type, portal_brand
      INTO v_current_is_mirror, v_current_campus, v_current_type, v_current_portal
      FROM public.leads
     WHERE id = p_current_lead_id;
    -- Keep a real lead unless it is the other school brand from this application.
    IF FOUND AND v_current_is_mirror IS NOT TRUE
       AND public.school_lead_brand(v_current_portal, v_current_campus, v_current_type)
         IS NOT DISTINCT FROM v_app_brand THEN
      RETURN p_current_lead_id;
    END IF;
  END IF;

  v_digits := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
  IF length(v_digits) <> 10 THEN
    v_digits := NULL;
  END IF;

  SELECT l.id INTO v_lead_id
    FROM public.leads l
   WHERE (
        (p_application_id IS NOT NULL AND l.application_id = p_application_id)
     OR (v_digits IS NOT NULL
         AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_digits)
     OR l.id = p_current_lead_id
   )
     AND public.school_lead_brand(l.portal_brand, l.campus_id, l.lead_institution_type) = v_app_brand
   ORDER BY
     CASE WHEN p_campus_id IS NOT NULL AND l.campus_id = p_campus_id THEN 0 ELSE 1 END,
     CASE WHEN COALESCE(l.is_mirror, false) THEN 1 ELSE 0 END,
     CASE WHEN l.counsellor_id IS NOT NULL THEN 0 ELSE 1 END,
     CASE WHEN l.admission_no IS NOT NULL THEN 0 ELSE 1 END,
     CASE WHEN l.pre_admission_no IS NOT NULL THEN 0 ELSE 1 END,
     CASE WHEN p_application_id IS NOT NULL AND l.application_id = p_application_id THEN 0 ELSE 1 END,
     CASE l.stage::text
       WHEN 'admitted' THEN 0
       WHEN 'pre_admitted' THEN 1
       WHEN 'token_paid' THEN 2
       WHEN 'offer_sent' THEN 3
       WHEN 'application_submitted' THEN 4
       WHEN 'application_in_progress' THEN 5
       ELSE 8
     END,
     l.created_at ASC
   LIMIT 1;

  RETURN v_lead_id;
END;
$$;

-- ── 2. Attach new/resumed applications to that canonical lead ────────────

CREATE OR REPLACE FUNCTION public.upsert_application_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _application_id text DEFAULT NULL,
  _source text DEFAULT 'website',
  _ga_client_id text DEFAULT NULL,
  _ga_session_id text DEFAULT NULL,
  _gclid text DEFAULT NULL,
  _utm_source text DEFAULT NULL,
  _utm_medium text DEFAULT NULL,
  _utm_campaign text DEFAULT NULL,
  _utm_term text DEFAULT NULL,
  _utm_content text DEFAULT NULL,
  _landing_page text DEFAULT NULL,
  _referrer text DEFAULT NULL,
  _origin_domain text DEFAULT NULL,
  _fbc text DEFAULT NULL,
  _fbp text DEFAULT NULL,
  _portal_brand text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  IF _phone IS NOT NULL AND length(regexp_replace(_phone, '\D', '', 'g')) = 10 THEN
    _phone := '+91' || regexp_replace(_phone, '\D', '', 'g');
  END IF;

  v_lead_id := public.canonical_application_lead_id(
    _phone, _application_id, NULL, _campus_id, _course_id, _portal_brand
  );

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET stage = CASE
          WHEN stage IN ('new_lead', 'ai_called', 'counsellor_call') THEN 'application_in_progress'::lead_stage
          ELSE stage
        END,
      application_id = COALESCE(_application_id, application_id),
      course_id      = COALESCE(_course_id, course_id),
      campus_id      = COALESCE(_campus_id, campus_id),
      email          = COALESCE(_email, email),
      person_role    = 'applicant',
      ga_client_id   = COALESCE(ga_client_id, _ga_client_id),
      ga_session_id  = COALESCE(ga_session_id, _ga_session_id),
      gclid          = COALESCE(gclid, _gclid),
      utm_source     = COALESCE(utm_source, _utm_source),
      utm_medium     = COALESCE(utm_medium, _utm_medium),
      utm_campaign   = COALESCE(utm_campaign, _utm_campaign),
      utm_term       = COALESCE(utm_term, _utm_term),
      utm_content    = COALESCE(utm_content, _utm_content),
      landing_page   = COALESCE(landing_page, _landing_page),
      referrer       = COALESCE(referrer, _referrer),
      origin_domain  = COALESCE(origin_domain, _origin_domain),
      fbc            = COALESCE(fbc, _fbc),
      fbp            = COALESCE(_fbp, fbp),
      portal_brand   = COALESCE(_portal_brand, portal_brand),
      updated_at     = now()
    WHERE id = v_lead_id;
  ELSE
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, stage, person_role, application_id,
      ga_client_id, ga_session_id, gclid,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      landing_page, referrer, origin_domain,
      fbc, fbp, portal_brand
    ) VALUES (
      COALESCE(NULLIF(_name, ''), 'Applicant'),
      _phone,
      _email,
      _course_id,
      _campus_id,
      _source::lead_source,
      'application_in_progress'::lead_stage,
      'applicant',
      _application_id,
      _ga_client_id, _ga_session_id, _gclid,
      _utm_source, _utm_medium, _utm_campaign, _utm_term, _utm_content,
      _landing_page, _referrer, _origin_domain,
      _fbc, _fbp, _portal_brand
    )
    RETURNING id INTO v_lead_id;
  END IF;

  RETURN v_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_applications_ensure_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_campus_id uuid;
  v_portal_brand text;
  v_canonical uuid;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.course_selections) = 'array'
     AND jsonb_array_length(NEW.course_selections) > 0 THEN
    BEGIN
      v_course_id := (NEW.course_selections->0->>'course_id')::uuid;
    EXCEPTION WHEN others THEN
      v_course_id := NULL;
    END;
    BEGIN
      v_campus_id := (NEW.course_selections->0->>'campus_id')::uuid;
    EXCEPTION WHEN others THEN
      v_campus_id := NULL;
    END;
  END IF;

  SELECT substring(f FROM 8) INTO v_portal_brand
    FROM unnest(COALESCE(NEW.flags, ARRAY[]::text[])) AS f
   WHERE f LIKE 'portal:%'
   LIMIT 1;

  -- Honour an explicit same-brand link (apply-on-behalf / CRM phone ≠ OTP
  -- phone). Never jump a Beacon application onto a Mirai lead or the reverse.
  v_canonical := public.canonical_application_lead_id(
    NEW.phone, NEW.application_id, NEW.lead_id, v_campus_id, v_course_id, v_portal_brand
  );
  IF NEW.lead_id IS NOT NULL THEN
    IF v_canonical IS NOT NULL THEN
      NEW.lead_id := v_canonical;
    END IF;
    RETURN NEW;
  END IF;

  BEGIN
    NEW.lead_id := public.upsert_application_lead(
      COALESCE(NULLIF(NEW.full_name, ''), 'Applicant'),
      NEW.phone,
      NEW.email,
      v_course_id,
      v_campus_id,
      NEW.application_id,
      'website',
      _portal_brand => v_portal_brand
    );
  EXCEPTION WHEN others THEN
    IF v_canonical IS NOT NULL THEN
      NEW.lead_id := v_canonical;
    END IF;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_ensure_lead ON public.applications;
CREATE TRIGGER trg_applications_ensure_lead
  BEFORE INSERT
  ON public.applications
  FOR EACH ROW
  WHEN (NEW.phone IS NOT NULL AND NEW.phone <> '')
  EXECUTE FUNCTION public.fn_applications_ensure_lead();

DROP TRIGGER IF EXISTS trg_applications_ensure_lead_update ON public.applications;
CREATE TRIGGER trg_applications_ensure_lead_update
  BEFORE UPDATE OF lead_id, phone, full_name, email, application_id, course_selections
  ON public.applications
  FOR EACH ROW
  WHEN (
    NEW.phone IS NOT NULL AND NEW.phone <> ''
    AND (
      NEW.lead_id IS NULL
      OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
      OR NEW.phone IS DISTINCT FROM OLD.phone
    )
  )
  EXECUTE FUNCTION public.fn_applications_ensure_lead();

CREATE OR REPLACE FUNCTION public.get_application_lead(_application_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_app_lead_id uuid;
  v_app_phone text;
  v_app_campus uuid;
  v_app_course uuid;
  v_app_portal text;
  v_lead_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'principal'::app_role)
    OR public.has_role(v_uid, 'admission_head'::app_role)
    OR public.has_role(v_uid, 'campus_admin'::app_role)
    OR public.has_role(v_uid, 'data_entry'::app_role)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT lead_id, phone INTO v_app_lead_id, v_app_phone
    FROM public.applications
   WHERE application_id = _application_id;

  BEGIN
    SELECT
      NULLIF(course_selections->0->>'campus_id', '')::uuid,
      NULLIF(course_selections->0->>'course_id', '')::uuid
      INTO v_app_campus, v_app_course
      FROM public.applications
     WHERE application_id = _application_id
       AND jsonb_typeof(course_selections) = 'array'
       AND jsonb_array_length(course_selections) > 0;
  EXCEPTION WHEN others THEN
    v_app_campus := NULL;
    v_app_course := NULL;
  END;

  SELECT substring(f FROM 8) INTO v_app_portal
    FROM public.applications a
    CROSS JOIN LATERAL unnest(COALESCE(a.flags, ARRAY[]::text[])) AS f
   WHERE a.application_id = _application_id
     AND f LIKE 'portal:%'
   LIMIT 1;

  v_lead_id := public.canonical_application_lead_id(
    v_app_phone, _application_id, v_app_lead_id, v_app_campus, v_app_course, v_app_portal
  );

  IF v_lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_app_lead_id IS DISTINCT FROM v_lead_id THEN
    UPDATE public.applications
       SET lead_id = v_lead_id
     WHERE application_id = _application_id
       AND (lead_id IS NULL OR lead_id IS DISTINCT FROM v_lead_id);
  END IF;

  SELECT to_jsonb(x) INTO v_result
  FROM (
    SELECT
      l.id, l.name, l.phone, l.course_id, l.campus_id,
      l.pre_admission_no, l.admission_no, l.consultant_id, l.academic_partner_id,
      CASE WHEN con.id IS NULL THEN NULL
           ELSE jsonb_build_object('name', con.name) END AS lead_consultant,
      CASE WHEN c.id IS NULL THEN NULL
           ELSE jsonb_build_object(
             'name', c.name, 'code', c.code, 'duration_years', c.duration_years,
             'eligibility', c.eligibility, 'entrance_exam', c.entrance_exam,
             'entrance_mandatory', c.entrance_mandatory) END AS course
    FROM public.leads l
    LEFT JOIN public.consultants con ON con.id = l.consultant_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = v_lead_id
  ) x;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_lead(text) TO authenticated;

-- ── 3. Counsellor application list: primary and secondary assignees ──────

CREATE OR REPLACE FUNCTION public.counsellor_applications()
RETURNS TABLE (
  id uuid,
  application_id text,
  lead_id uuid,
  full_name text,
  phone text,
  email text,
  status text,
  payment_status text,
  payment_ref text,
  fee_amount numeric,
  program_category text,
  course_selections jsonb,
  completed_sections jsonb,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  flags text[],
  dob date,
  gender text,
  category text,
  father jsonb,
  mother jsonb,
  address jsonb,
  academic_details jsonb,
  form_pdf_url text,
  fee_receipt_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id,
    a.application_id,
    a.lead_id,
    a.full_name,
    a.phone,
    a.email,
    a.status,
    a.payment_status,
    a.payment_ref,
    a.fee_amount,
    a.program_category,
    a.course_selections,
    a.completed_sections,
    a.submitted_at,
    a.created_at,
    a.updated_at,
    a.flags,
    a.dob,
    a.gender,
    a.category,
    a.father,
    a.mother,
    a.address,
    a.academic_details,
    a.form_pdf_url,
    a.fee_receipt_url
  FROM public.applications a
  JOIN public.leads l ON l.id = a.lead_id
  WHERE EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND (
        p.id = l.counsellor_id
        OR EXISTS (
          SELECT 1 FROM public.lead_counsellors lc
          WHERE lc.lead_id = l.id AND lc.counsellor_id = p.id
        )
      )
  )
  ORDER BY a.updated_at DESC, a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_applications() TO authenticated;

-- ── 4. Best application for a student/lead (same lead only)

CREATE OR REPLACE FUNCTION public.best_application_for_lead(p_lead_id uuid)
RETURNS SETOF public.applications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.*
    FROM public.applications a
   WHERE a.lead_id = p_lead_id
   ORDER BY
     CASE a.status
       WHEN 'approved' THEN 0
       WHEN 'submitted' THEN 1
       WHEN 'under_review' THEN 2
       ELSE 3
     END,
     a.created_at DESC
   LIMIT 1;
$$;

-- ── 5. Copy application-form files onto the student record ───────────────

CREATE OR REPLACE FUNCTION public.copy_application_documents_to_student(p_student_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead uuid;
  v_app public.applications%ROWTYPE;
  v_photo text;
  v_copied int := 0;
  v_form_copied int := 0;
BEGIN
  SELECT lead_id INTO v_lead FROM public.students WHERE id = p_student_id;
  IF v_lead IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_app FROM public.best_application_for_lead(v_lead);
  IF v_app.application_id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.student_documents (
    student_id, document_name, file_url, file_name, file_size, mime_type
  )
  SELECT
    p_student_id,
    COALESCE(NULLIF(ad.original_file_name, ''), initcap(replace(ad.doc_key, '_', ' '))),
    ad.file_url,
    COALESCE(ad.file_name, ad.original_file_name, ad.doc_key),
    ad.file_size,
    ad.mime_type
  FROM public.application_documents ad
  WHERE ad.application_id = v_app.application_id
    AND COALESCE(ad.file_url, '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.student_documents sd
      WHERE sd.student_id = p_student_id AND sd.file_url = ad.file_url
    );
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  IF COALESCE(v_app.form_pdf_url, '') <> '' THEN
    INSERT INTO public.student_documents (
      student_id, document_name, file_url, file_name, mime_type
    )
    SELECT
      p_student_id,
      'Application Form',
      v_app.form_pdf_url,
      'application-form.pdf',
      'application/pdf'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_documents sd
      WHERE sd.student_id = p_student_id AND sd.file_url = v_app.form_pdf_url
    );
    GET DIAGNOSTICS v_form_copied = ROW_COUNT;
    v_copied := v_copied + v_form_copied;
  END IF;

  SELECT ad.file_url INTO v_photo
    FROM public.application_documents ad
   WHERE ad.application_id = v_app.application_id
     AND ad.doc_key IN ('student_photo', 'photo', 'photograph')
     AND COALESCE(ad.file_url, '') <> ''
   ORDER BY ad.uploaded_at DESC NULLS LAST
   LIMIT 1;

  IF v_photo IS NOT NULL THEN
    UPDATE public.students
       SET photo_url = COALESCE(NULLIF(photo_url, ''), v_photo)
     WHERE id = p_student_id
       AND COALESCE(photo_url, '') = '';
  END IF;

  UPDATE public.students SET
    tc_submitted = COALESCE(tc_submitted, false) OR EXISTS (
      SELECT 1 FROM public.application_documents ad
      WHERE ad.application_id = v_app.application_id
        AND ad.doc_key = 'transfer_certificate'
        AND COALESCE(ad.file_url, '') <> ''
    ),
    marksheet_submitted = COALESCE(marksheet_submitted, false) OR EXISTS (
      SELECT 1 FROM public.application_documents ad
      WHERE ad.application_id = v_app.application_id
        AND ad.doc_key IN ('report_card', 'class_10_marksheet', 'class_12_marksheet')
        AND COALESCE(ad.file_url, '') <> ''
    ),
    dob_certificate_submitted = COALESCE(dob_certificate_submitted, false) OR EXISTS (
      SELECT 1 FROM public.application_documents ad
      WHERE ad.application_id = v_app.application_id
        AND ad.doc_key = 'birth_certificate'
        AND COALESCE(ad.file_url, '') <> ''
    )
  WHERE id = p_student_id;

  RETURN v_copied;
END;
$$;

GRANT EXECUTE ON FUNCTION public.copy_application_documents_to_student(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_copy_app_docs_on_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.copy_application_documents_to_student(NEW.id);
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_copy_app_docs_on_student ON public.students;
CREATE TRIGGER trg_copy_app_docs_on_student
  AFTER INSERT OR UPDATE OF lead_id, pre_admission_no, admission_no
  ON public.students
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_copy_app_docs_on_student();

CREATE OR REPLACE FUNCTION public.fn_migrate_application_to_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  FROM public.best_application_for_lead(NEW.lead_id) a;

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
    guardian_phone = COALESCE(guardian_phone, NULLIF(v_guardian->>'phone', '')),
    guardian_email = COALESCE(guardian_email, NULLIF(v_guardian->>'email', ''))
  WHERE id = NEW.id;

  PERFORM public.copy_application_documents_to_student(NEW.id);
  PERFORM public.sync_fee_ledger_concessions(NEW.id);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_student_from_application(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_docs       integer := 0;
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
  FROM public.best_application_for_lead(s.lead_id) a;

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
    guardian_phone = COALESCE(guardian_phone, NULLIF(v_guardian->>'phone', '')),
    guardian_email = COALESCE(guardian_email, NULLIF(v_guardian->>'email', ''))
  WHERE id = s.id;

  v_docs := public.copy_application_documents_to_student(s.id);
  PERFORM public.sync_fee_ledger_concessions(s.id);

  RETURN jsonb_build_object(
    'ok', true,
    'app_id', v_app_id,
    'app_status', v_app_status,
    'documents_copied', v_docs,
    'note', 'fields updated (COALESCE — existing data not overwritten)'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.backfill_student_from_application(uuid) TO authenticated, service_role;

-- ── 6. Offer concessions on the student ledger ───────────────────────────

CREATE OR REPLACE FUNCTION public.sync_fee_ledger_concessions(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead     uuid;
  v_offer    uuid;
  v_term     text;
  v_category text;
  v_wamt     numeric;
  v_cap_sum  numeric;
  v_capped   numeric;
  v_alloc    numeric;
  v_cnt      int;
  v_i        int;
  v_share    numeric;
  rec        record;
BEGIN
  UPDATE fee_ledger fl
     SET concession = LEAST(
           COALESCE((
             SELECT SUM(CASE WHEN c.type = 'flat'
                             THEN c.value
                             ELSE round(fl.total_amount * c.value / 100, 2) END)
               FROM concessions c
              WHERE c.fee_ledger_id = fl.id
                AND c.status = 'approved'
           ), 0)
           + COALESCE((
             SELECT SUM(flp.concession_amount)
               FROM fee_ledger_payments flp
              WHERE flp.fee_ledger_id = fl.id
           ), 0),
           fl.total_amount)
   WHERE fl.student_id = p_student_id;

  SELECT lead_id INTO v_lead FROM students WHERE id = p_student_id;
  IF v_lead IS NULL THEN RETURN; END IF;

  SELECT id INTO v_offer
    FROM offer_letters
   WHERE lead_id = v_lead
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_offer IS NULL THEN RETURN; END IF;

  FOR v_term, v_category, v_wamt IN
    SELECT
      term,
      NULLIF(btrim(COALESCE(fee_category, metadata->>'category', '')), ''),
      SUM(amount)
    FROM offer_waivers
    WHERE offer_letter_id = v_offer
      AND status = 'approved'
    GROUP BY
      term,
      NULLIF(btrim(COALESCE(fee_category, metadata->>'category', '')), '')
    ORDER BY 2 NULLS LAST
  LOOP
    -- Room is list price minus concessions already on the row. Token/list-price
    -- collections must not hide the offer waiver (same rule as payment-sourced
    -- Year-1 lump-sum concessions).
    SELECT
      COALESCE(SUM(GREATEST(fl.total_amount - fl.concession, 0)), 0),
      COUNT(*) FILTER (WHERE GREATEST(fl.total_amount - fl.concession, 0) > 0)
    INTO v_cap_sum, v_cnt
    FROM fee_ledger fl
    JOIN fee_codes fc ON fc.id = fl.fee_code_id
    WHERE fl.student_id = p_student_id
      AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'))
      AND (v_category IS NULL OR fc.category = v_category)
      AND NOT EXISTS (SELECT 1 FROM optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id);

    IF v_cap_sum <= 0 OR v_cnt = 0 THEN CONTINUE; END IF;

    v_capped := LEAST(v_wamt, v_cap_sum);
    v_alloc  := 0;
    v_i      := 0;

    FOR rec IN
      SELECT fl.id,
             GREATEST(fl.total_amount - fl.concession, 0) AS cap
        FROM fee_ledger fl
        JOIN fee_codes fc ON fc.id = fl.fee_code_id
       WHERE fl.student_id = p_student_id
         AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'))
         AND (v_category IS NULL OR fc.category = v_category)
         AND GREATEST(fl.total_amount - fl.concession, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id)
       ORDER BY cap DESC, fl.id
    LOOP
      v_i := v_i + 1;
      IF v_i = v_cnt THEN
        v_share := v_capped - v_alloc;
      ELSE
        v_share := round(v_capped * rec.cap / v_cap_sum, 2);
      END IF;
      UPDATE fee_ledger SET concession = concession + v_share WHERE id = rec.id;
      v_alloc := v_alloc + v_share;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_offer_letter_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_year numeric;
  v_token      numeric;
  v_student    uuid;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads
     SET session_id = COALESCE(
           session_id,
           NEW.session_id,
           (SELECT id FROM public.admission_sessions
             WHERE CURRENT_DATE BETWEEN start_date AND end_date
             ORDER BY is_active DESC, start_date DESC
             LIMIT 1)
         )
   WHERE id = NEW.lead_id;

  v_first_year := public.lead_first_year_fee(NEW.lead_id);
  v_token      := ROUND(v_first_year * 0.10, 2);

  IF v_token > 0 THEN
    UPDATE public.leads
       SET token_amount = v_token
     WHERE id = NEW.lead_id;
  END IF;

  -- Waivers are often inserted while the offer is still pending_principal.
  -- sync_fee_ledger_concessions only reads approved offers, so approval is
  -- the moment the ledger can actually receive them.
  FOR v_student IN
    SELECT s.id
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND s.lead_id = NEW.lead_id
  LOOP
    PERFORM public.sync_fee_ledger_concessions(v_student);
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── 7. Backfill documents and offer concessions on existing students ─────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.id
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND s.lead_id IS NOT NULL
       AND (s.admission_no IS NOT NULL OR s.pre_admission_no IS NOT NULL)
  LOOP
    BEGIN
      PERFORM public.copy_application_documents_to_student(r.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'document copy skipped for student %: %', r.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT DISTINCT s.id
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND s.lead_id IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.offer_letters ol
           JOIN public.offer_waivers ow
             ON ow.offer_letter_id = ol.id
            AND ow.status = 'approved'
          WHERE ol.approval_status = 'approved'
            AND ol.lead_id = s.lead_id
       )
  LOOP
    BEGIN
      PERFORM public.sync_fee_ledger_concessions(r.id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'concession sync skipped for student %: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;
