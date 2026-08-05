-- Resolve course_info template variables for an explicitly chosen course.
--
-- fn_resolve_course_info_params(lead_id) already derives duration, eligibility,
-- approval, course_url and video_url — but only from leads.course_id, and it
-- returns NULL when the lead has no course on it. Counsellors then had to type
-- five fields by hand for course_info_v1..v4, which is exactly the data we
-- already hold on the course record.
--
-- This is the same resolution keyed by course instead of lead, so the template
-- picker can offer a course dropdown (defaulting to the lead's course) and fill
-- the variables from it.
--
-- Kept as a separate function rather than adding a parameter to the existing
-- one: whatsapp-send calls that one by lead_id on every course_info send, and
-- changing its signature would break the deployed edge function mid-rollout.

CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_params_by_course(
  p_course_id    uuid,
  p_student_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_course      record;
  v_eligibility text;
  v_approval    text;
  v_course_url  text;
  v_video_url   text;
  v_duration    text;
BEGIN
  SELECT c.id, c.name, c.code, c.duration_years, c.type, c.video_url, c.slug,
         c.curriculum_url, c.marketing_eligibility
    INTO v_course
    FROM public.courses c
   WHERE c.id = p_course_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_duration := v_course.duration_years
                || ' year' || CASE WHEN v_course.duration_years = 1 THEN '' ELSE 's' END
                || ' (' || v_course.type || ')';

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

  SELECT string_agg(DISTINCT ab.short_name, ', ' ORDER BY ab.short_name)
    INTO v_approval
    FROM public.approval_letter_courses alc
    JOIN public.approval_letters al ON al.id = alc.letter_id
    JOIN public.approval_bodies ab  ON ab.id = al.approval_body_id
   WHERE alc.course_id = v_course.id
     AND al.is_active IS TRUE AND ab.is_active IS TRUE
     AND ab.short_name IS NOT NULL;
  IF v_approval IS NULL OR length(v_approval) = 0 THEN
    v_approval := 'NIMT Educational Institutions';
  END IF;

  IF v_course.slug IS NOT NULL THEN
    v_course_url := 'https://www.nimt.ac.in/courses/' || v_course.slug || '#admissions';
  ELSE
    v_course_url := 'https://www.nimt.ac.in/courses';
  END IF;

  v_video_url := COALESCE(NULLIF(v_course.video_url, ''), v_course_url);

  RETURN jsonb_build_object(
    'student_name', p_student_name,
    'course_name',  v_course.name,
    'duration',     v_duration,
    'eligibility',  v_eligibility,
    'approval',     v_approval,
    'video_url',    v_video_url,
    'course_url',   v_course_url
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_resolve_course_info_params_by_course(uuid, text) IS
  'course_info template variables (duration/eligibility/approval/course_url/video_url) for an explicitly chosen course. Mirrors fn_resolve_course_info_params but keyed by course rather than lead, so the template picker can offer a course dropdown.';

REVOKE ALL ON FUNCTION public.fn_resolve_course_info_params_by_course(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_resolve_course_info_params_by_course(uuid, text) TO authenticated;
