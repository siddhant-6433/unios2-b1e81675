-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260810055717 name=course_marketing_info_reads_course_facts applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- The website's course view now renders curated facts too.
--
-- `eligibility` keeps its position and name (existing consumers depend on it)
-- but resolves from course_facts first. The remaining curated fields are
-- APPENDED — CREATE OR REPLACE VIEW cannot reorder or rename existing columns.
CREATE OR REPLACE VIEW public.course_marketing_info AS
 SELECT c.id AS course_id,
    c.name AS course_name,
    c.code AS course_code,
    c.duration_years,
    COALESCE(NULLIF(btrim(cf.eligibility), ''), c.eligibility) AS eligibility,
    c.description,
    c.course_summary,
    c.video_url_en,
    c.video_url_hi,
    c.cover_image_url,
    cam.id AS campus_id,
    cam.name AS campus_name,
    cam.apply_url,
    COALESCE(inst.google_maps_url, cam.google_maps_url) AS google_maps_url,
    -- curated single-source-of-truth fields
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
