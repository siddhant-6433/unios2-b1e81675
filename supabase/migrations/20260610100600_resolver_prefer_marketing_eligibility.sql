-- Resolver update: prefer courses.marketing_eligibility (customer-facing,
-- curated) over eligibility_rules.notes (internal admin field) when filling
-- the course_info_v1 WhatsApp body. Falls through to the existing logic for
-- courses that don't have a marketing_eligibility set yet.

CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_params(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead       record;
  v_course     record;
  v_eligibility text;
  v_approval    text;
  v_course_url  text;
  v_video_url   text;
  v_duration    text;
BEGIN
  SELECT id, name, course_id
    INTO v_lead
    FROM public.leads
   WHERE id = p_lead_id;

  IF NOT FOUND OR v_lead.course_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id, c.name, c.code, c.duration_years, c.type, c.video_url, c.slug,
         c.curriculum_url, c.marketing_eligibility
    INTO v_course
    FROM public.courses c
   WHERE c.id = v_lead.course_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_duration := v_course.duration_years
                || ' year' || CASE WHEN v_course.duration_years = 1 THEN '' ELSE 's' END
                || ' (' || v_course.type || ')';

  -- Priority for eligibility text:
  --   1. courses.marketing_eligibility (curated, customer-facing)
  --   2. eligibility_rules.notes  (admin notes — may contain policy details)
  --   3. structured fields (class_12_min_marks, subject_prerequisites, etc.)
  --   4. fallback string
  v_eligibility := NULLIF(trim(v_course.marketing_eligibility), '');

  IF v_eligibility IS NULL THEN
    SELECT
      COALESCE(
        NULLIF(trim(er.notes), ''),
        trim(
          concat_ws(', ',
            CASE WHEN er.class_12_min_marks IS NOT NULL
                 THEN '10+2 with min ' || er.class_12_min_marks || '%' END,
            CASE WHEN er.requires_graduation
                 THEN 'Graduation' ||
                      CASE WHEN er.graduation_min_marks IS NOT NULL
                           THEN ' (min ' || er.graduation_min_marks || '%)'
                           ELSE '' END END,
            CASE WHEN er.subject_prerequisites IS NOT NULL
                  AND array_length(er.subject_prerequisites, 1) > 0
                 THEN 'subjects: ' || array_to_string(er.subject_prerequisites, '/') END,
            CASE WHEN er.entrance_exam_required AND er.entrance_exam_name IS NOT NULL
                 THEN er.entrance_exam_name || ' required' END,
            CASE WHEN er.min_age IS NOT NULL OR er.max_age IS NOT NULL
                 THEN 'age '
                      || COALESCE(er.min_age::text, '0')
                      || '-' || COALESCE(er.max_age::text, 'no limit') END
          )
        )
      )
      INTO v_eligibility
      FROM public.eligibility_rules er
     WHERE er.course_id = v_course.id;
  END IF;

  IF v_eligibility IS NULL OR length(v_eligibility) = 0 THEN
    v_eligibility := 'Contact admissions for eligibility details';
  END IF;

  -- Approval bodies — comma-joined short names, deduped, active letters only.
  SELECT string_agg(DISTINCT ab.short_name, ', ' ORDER BY ab.short_name)
    INTO v_approval
    FROM public.approval_letter_courses alc
    JOIN public.approval_letters al ON al.id = alc.letter_id
    JOIN public.approval_bodies ab  ON ab.id = al.approval_body_id
   WHERE alc.course_id = v_course.id
     AND al.is_active IS TRUE
     AND ab.is_active IS TRUE
     AND ab.short_name IS NOT NULL;

  IF v_approval IS NULL OR length(v_approval) = 0 THEN
    v_approval := 'NIMT Educational Institutions';
  END IF;

  -- Course page URL — slug-based when known, else listing page.
  IF v_course.slug IS NOT NULL THEN
    v_course_url := 'https://www.nimt.ac.in/courses/' || v_course.slug || '#admissions';
  ELSE
    v_course_url := 'https://www.nimt.ac.in/courses';
  END IF;

  -- Video URL — explicit per-course video, else fall back to the course page so
  -- the button always points somewhere useful.
  v_video_url := COALESCE(NULLIF(v_course.video_url, ''), v_course_url);

  RETURN jsonb_build_object(
    'student_name', v_lead.name,
    'course_name',  v_course.name,
    'duration',     v_duration,
    'eligibility',  v_eligibility,
    'approval',     v_approval,
    'video_url',    v_video_url,
    'course_url',   v_course_url
  );
END;
$$;
