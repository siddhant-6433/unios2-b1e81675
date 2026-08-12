-- Point every course-info surface at course_facts.
--
-- Applied to prod via MCP alongside the table + seed; recorded here so the repo
-- matches. See 20260810*_course_facts_single_source_of_truth.sql for the why.
--
-- Resolution order per field: curated course_facts -> legacy column -> derived.
-- Nothing goes blank during rollout, but a curated value always wins.

-- Affiliation label: curated string, then courses.affiliations, then the
-- approval_letters archive (which is a document history, not a current-status
-- statement, and is why BMRIT used to read "ABVMU, CCSU").
CREATE OR REPLACE FUNCTION public.fn_course_affiliation_label(p_course_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH curated_fact AS (
    SELECT NULLIF(trim(cf.affiliation), '') AS label
    FROM public.course_facts cf WHERE cf.course_id = p_course_id
  ),
  curated_array AS (
    SELECT string_agg(COALESCE(ab.short_name, t.aff), ', ' ORDER BY t.ord) AS label
    FROM public.courses c
    CROSS JOIN LATERAL unnest(c.affiliations) WITH ORDINALITY AS t(aff, ord)
    LEFT JOIN public.approval_bodies ab ON ab.name = t.aff AND ab.is_active IS TRUE
    WHERE c.id = p_course_id
      AND c.affiliations IS NOT NULL AND array_length(c.affiliations, 1) > 0
  ),
  from_letters AS (
    SELECT string_agg(DISTINCT ab.short_name, ', ' ORDER BY ab.short_name) AS label
    FROM public.approval_letter_courses alc
    JOIN public.approval_letters al ON al.id = alc.letter_id
    JOIN public.approval_bodies  ab ON ab.id = al.approval_body_id
    WHERE alc.course_id = p_course_id
      AND al.is_active IS TRUE AND ab.is_active IS TRUE AND ab.short_name IS NOT NULL
  )
  SELECT COALESCE(
    (SELECT label FROM curated_fact),
    NULLIF((SELECT label FROM curated_array), ''),
    NULLIF((SELECT label FROM from_letters), ''),
    'NIMT Educational Institutions'
  );
$fn$;

-- The one resolver every surface calls.
CREATE OR REPLACE FUNCTION public.fn_course_facts(p_course_id uuid, p_student_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object(
    'course_id', c.id, 'course_code', c.code, 'course_name', c.name,
    'student_name', p_student_name,
    'duration', COALESCE(NULLIF(trim(cf.duration), ''),
        CASE WHEN c.duration_years IS NOT NULL
             THEN c.duration_years || ' year' || CASE WHEN c.duration_years = 1 THEN '' ELSE 's' END
                  || COALESCE(' (' || c.type || ')', '') END),
    'eligibility', COALESCE(NULLIF(trim(cf.eligibility), ''), NULLIF(trim(c.eligibility), ''),
        NULLIF(trim(er.notes), ''), 'Contact admissions for eligibility details'),
    'entrance_exam', COALESCE(NULLIF(trim(cf.entrance_exam), ''), NULLIF(trim(c.entrance_exam), ''),
        NULLIF(trim(er.entrance_exam_name), '')),
    'approval', public.fn_course_affiliation_label(c.id),
    'age_requirement', NULLIF(trim(cf.age_requirement), ''),
    'intake_seats', COALESCE(NULLIF(trim(cf.intake_seats), ''), c.seats::text, er.intake_capacity::text),
    'subjects', COALESCE(NULLIF(trim(cf.subjects), ''), array_to_string(er.subject_prerequisites, ', ')),
    'fee_first_year', COALESCE(NULLIF(trim(cf.fee_first_year), ''), c.fee_per_year::text),
    'course_url', CASE WHEN c.slug IS NOT NULL
        THEN 'https://www.nimt.ac.in/courses/' || c.slug || '#admissions'
        ELSE 'https://www.nimt.ac.in/courses' END,
    'video_url', COALESCE(NULLIF(c.video_url, ''),
        CASE WHEN c.slug IS NOT NULL THEN 'https://www.nimt.ac.in/courses/' || c.slug || '#admissions'
             ELSE 'https://www.nimt.ac.in/courses' END),
    'curated', (cf.course_id IS NOT NULL),
    'verified_at', cf.verified_at
  )
  FROM public.courses c
  LEFT JOIN public.course_facts cf ON cf.course_id = c.id
  LEFT JOIN public.eligibility_rules er ON er.course_id = c.id
  WHERE c.id = p_course_id;
$fn$;

COMMENT ON FUNCTION public.fn_course_facts(uuid, text) IS
  'The single course-info resolver. Reads curated course_facts, falling back to legacy columns per field. Every student-facing surface renders from this.';

REVOKE ALL ON FUNCTION public.fn_course_facts(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_course_facts(uuid, text) TO authenticated, service_role;

-- WhatsApp course_info templates delegate to the same resolver.
CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_params_by_course(
  p_course_id uuid, p_student_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN f IS NULL THEN NULL ELSE jsonb_build_object(
    'student_name', p_student_name, 'course_name', f->>'course_name',
    'duration', f->>'duration', 'eligibility', f->>'eligibility',
    'approval', f->>'approval', 'video_url', f->>'video_url', 'course_url', f->>'course_url'
  ) END
  FROM (SELECT public.fn_course_facts(p_course_id, p_student_name) AS f) s;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_resolve_course_info_params(p_lead_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT public.fn_resolve_course_info_params_by_course(l.course_id, l.name)
  FROM public.leads l WHERE l.id = p_lead_id AND l.course_id IS NOT NULL;
$fn$;

-- Website view renders curated facts too. New columns are APPENDED because
-- CREATE OR REPLACE VIEW cannot reorder or rename existing ones.
CREATE OR REPLACE VIEW public.course_marketing_info AS
 SELECT c.id AS course_id, c.name AS course_name, c.code AS course_code, c.duration_years,
    COALESCE(NULLIF(btrim(cf.eligibility), ''), c.eligibility) AS eligibility,
    c.description, c.course_summary, c.video_url_en, c.video_url_hi, c.cover_image_url,
    cam.id AS campus_id, cam.name AS campus_name, cam.apply_url,
    COALESCE(inst.google_maps_url, cam.google_maps_url) AS google_maps_url,
    COALESCE(NULLIF(btrim(cf.duration), ''),
             CASE WHEN c.duration_years IS NOT NULL
                  THEN c.duration_years || ' year' || CASE WHEN c.duration_years = 1 THEN '' ELSE 's' END
                  END) AS duration_text,
    COALESCE(NULLIF(btrim(cf.entrance_exam), ''), c.entrance_exam) AS entrance_exam,
    public.fn_course_affiliation_label(c.id) AS affiliation,
    NULLIF(btrim(cf.age_requirement), '') AS age_requirement,
    NULLIF(btrim(cf.subjects), '')        AS subject_requirement,
    COALESCE(NULLIF(btrim(cf.intake_seats), ''), c.seats::text) AS intake_seats,
    COALESCE(NULLIF(btrim(cf.fee_first_year), ''), c.fee_per_year::text) AS fee_first_year,
    cf.verified_at AS facts_verified_at
   FROM courses c
     LEFT JOIN public.course_facts cf ON cf.course_id = c.id
     JOIN departments d ON d.id = c.department_id
     JOIN institutions inst ON inst.id = d.institution_id
     JOIN campuses cam ON cam.id = inst.campus_id;
