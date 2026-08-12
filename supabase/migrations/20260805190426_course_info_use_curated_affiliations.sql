-- course_info templates: use the curated courses.affiliations, like every other surface.
--
-- Both course_info resolvers derived the "Accreditation" line by aggregating
-- every active row in approval_letters for the course:
--
--   string_agg(DISTINCT ab.short_name, ', ') FROM approval_letter_courses ...
--
-- approval_letters is a document ARCHIVE, not a statement of current standing.
-- It has no notion of recency, no distinction between an affiliating university
-- and a regulator, and no campus scoping. So BMRIT resolved to "ABVMU, CCSU" —
-- CCSU being the university NIMT's paramedical courses were affiliated to
-- before ABVMU, on letters issued 2012/2016/2017 that are still is_active.
-- 12 courses were affected. LLB-GN (Greater Noida) was worse: it resolved to
-- "BCI, DBALU, UoR" off letters literally titled "NIMT Kotputli".
--
-- courses.affiliations is the curated field the website and the lead-page Course
-- tab already use (see CourseInfoPanel: "Prefer course-level affiliations from
-- DB"). It is correct — BMRIT is {"Atal Bihari Vajpayee Medical University,
-- Lucknow"} and nothing else. WhatsApp was the only surface not reading it.
--
-- Curated order is preserved (affiliating university first, then councils), and
-- names are shortened via approval_bodies for message length — all 13 distinct
-- strings in use map cleanly. approval_letters stays as the fallback for any
-- course with no curated affiliations; the 43 such courses are all school grades
-- (Grade I, LKG, PYP), which never send course_info.

CREATE OR REPLACE FUNCTION public.fn_course_affiliation_label(p_course_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH curated AS (
    SELECT string_agg(COALESCE(ab.short_name, t.aff), ', ' ORDER BY t.ord) AS label
    FROM public.courses c
    CROSS JOIN LATERAL unnest(c.affiliations) WITH ORDINALITY AS t(aff, ord)
    LEFT JOIN public.approval_bodies ab
           ON ab.name = t.aff AND ab.is_active IS TRUE
    WHERE c.id = p_course_id
      AND c.affiliations IS NOT NULL
      AND array_length(c.affiliations, 1) > 0
  ),
  -- Only reached when a course has no curated affiliations at all.
  from_letters AS (
    SELECT string_agg(DISTINCT ab.short_name, ', ' ORDER BY ab.short_name) AS label
    FROM public.approval_letter_courses alc
    JOIN public.approval_letters al ON al.id = alc.letter_id
    JOIN public.approval_bodies  ab ON ab.id = al.approval_body_id
    WHERE alc.course_id = p_course_id
      AND al.is_active IS TRUE
      AND ab.is_active IS TRUE
      AND ab.short_name IS NOT NULL
  )
  SELECT COALESCE(
    NULLIF((SELECT label FROM curated), ''),
    NULLIF((SELECT label FROM from_letters), ''),
    'NIMT Educational Institutions'
  );
$fn$;

COMMENT ON FUNCTION public.fn_course_affiliation_label(uuid) IS
  'Affiliation/approval line for a course, from the curated courses.affiliations (the same source the website and lead-page Course tab use), shortened via approval_bodies. Falls back to the approval_letters archive only when a course has no curated affiliations.';

REVOKE ALL ON FUNCTION public.fn_course_affiliation_label(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_course_affiliation_label(uuid) TO authenticated;

-- Point both resolvers at it.
CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_params(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead        record;
  v_course      record;
  v_eligibility text;
  v_approval    text;
  v_course_url  text;
  v_video_url   text;
  v_duration    text;
BEGIN
  SELECT id, name, course_id INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.course_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.id, c.name, c.code, c.duration_years, c.type, c.video_url, c.slug,
         c.curriculum_url, c.marketing_eligibility
    INTO v_course
    FROM public.courses c
   WHERE c.id = v_lead.course_id;
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

  v_approval := public.fn_course_affiliation_label(v_course.id);

  IF v_course.slug IS NOT NULL THEN
    v_course_url := 'https://www.nimt.ac.in/courses/' || v_course.slug || '#admissions';
  ELSE
    v_course_url := 'https://www.nimt.ac.in/courses';
  END IF;

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
$function$;

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

  v_approval := public.fn_course_affiliation_label(v_course.id);

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
