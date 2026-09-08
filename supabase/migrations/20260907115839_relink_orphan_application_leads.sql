-- Fix: paid/approved applications show "Lead has been deleted" even when a lead
-- still exists (applications.lead_id is NULL, but leads.application_id or phone
-- still matches). Create Linked Lead then failed on idx_leads_phone_unique
-- because it inserted instead of matching the existing phone.
--
-- 1. get_application_lead reverse-looks up by application_id / phone and
--    relinks the application when the lead row is still there.
-- 2. Backfill remaining orphans via upsert_application_lead.
-- 3. Trigger so new applications cannot land without a lead_id when a phone
--    is present (the apply-portal RPC often fails and used to leave orphans).

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
  v_phone_digits text;
  v_lead_id uuid;
  v_result jsonb;
BEGIN
  -- Only admission-processing staff. Counsellors are intentionally excluded to
  -- preserve partner-lead privacy in the counsellor pool.
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

  v_lead_id := v_app_lead_id;

  -- Reverse lookup: the lead still exists but applications.lead_id was never
  -- set (or was SET NULL before ON DELETE RESTRICT).
  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE application_id = _application_id
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL AND v_app_phone IS NOT NULL AND v_app_phone <> '' THEN
    v_phone_digits := right(regexp_replace(v_app_phone, '\D', '', 'g'), 10);
    IF length(v_phone_digits) = 10 THEN
      SELECT id INTO v_lead_id
      FROM public.leads
      WHERE phone = ('+91' || v_phone_digits)
      LIMIT 1;
      IF v_lead_id IS NULL THEN
        SELECT id INTO v_lead_id
        FROM public.leads
        WHERE right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone_digits
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN NULL;  -- orphan application: genuinely no linked lead
  END IF;

  -- Heal the FK so the next read doesn't take the orphan path.
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

  RETURN v_result;  -- NULL only if the lead row truly no longer exists
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_lead(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_applications_ensure_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_campus_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL OR NEW.phone IS NULL OR NEW.phone = '' THEN
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

  BEGIN
    NEW.lead_id := public.upsert_application_lead(
      COALESCE(NULLIF(NEW.full_name, ''), 'Applicant'),
      NEW.phone,
      NEW.email,
      v_course_id,
      v_campus_id,
      NEW.application_id,
      'website'
    );
  EXCEPTION WHEN others THEN
    -- Never block the application write if lead upsert fails; staff can repair.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_ensure_lead ON public.applications;
CREATE TRIGGER trg_applications_ensure_lead
  BEFORE INSERT OR UPDATE OF lead_id, phone, full_name, email, application_id, course_selections
  ON public.applications
  FOR EACH ROW
  WHEN (NEW.lead_id IS NULL AND NEW.phone IS NOT NULL AND NEW.phone <> '')
  EXECUTE FUNCTION public.fn_applications_ensure_lead();

DO $$
DECLARE
  a RECORD;
  v_lead_id uuid;
  v_first_course uuid;
  v_first_campus uuid;
BEGIN
  FOR a IN
    SELECT id, application_id, full_name, phone, email, course_selections
    FROM public.applications
    WHERE lead_id IS NULL
      AND phone IS NOT NULL
      AND phone <> ''
  LOOP
    v_first_course := NULL;
    v_first_campus := NULL;
    IF jsonb_typeof(a.course_selections) = 'array' AND jsonb_array_length(a.course_selections) > 0 THEN
      BEGIN
        v_first_course := (a.course_selections->0->>'course_id')::uuid;
      EXCEPTION WHEN others THEN
        NULL;
      END;
      BEGIN
        v_first_campus := (a.course_selections->0->>'campus_id')::uuid;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;

    BEGIN
      v_lead_id := public.upsert_application_lead(
        COALESCE(NULLIF(a.full_name, ''), 'Applicant'),
        a.phone,
        a.email,
        v_first_course,
        v_first_campus,
        a.application_id,
        'website'
      );
    EXCEPTION WHEN unique_violation THEN
      -- leads.application_id is unique. APP-26-8041 already sits on another
      -- lead row, so creating/updating would fail. Attach that existing lead.
      SELECT id INTO v_lead_id
      FROM public.leads
      WHERE application_id = a.application_id
      LIMIT 1;
      IF v_lead_id IS NULL THEN
        SELECT id INTO v_lead_id
        FROM public.leads
        WHERE right(regexp_replace(phone, '\D', '', 'g'), 10)
            = right(regexp_replace(a.phone, '\D', '', 'g'), 10)
        LIMIT 1;
      END IF;
    END;

    IF v_lead_id IS NOT NULL THEN
      UPDATE public.applications SET lead_id = v_lead_id WHERE id = a.id AND lead_id IS NULL;
    END IF;
  END LOOP;
END;
$$;
