-- Pending AN Generation was reading a cached applications.admission_doc_status
-- that was never backfilled. Verified files therefore showed as "0/0 verified"
-- and mandatory_docs_complete stayed false, so the AN engine held numbers that
-- should already have been issued.
--
-- Compute completeness from the live review + upload rows (same rules as
-- sync-admission-doc-status), keep the cache fresh on write, and issue ANs
-- for pre-admitted students whose documents are already verified.

CREATE OR REPLACE FUNCTION public.application_doc_key_from_path(path text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT CASE
    WHEN filename ILIKE 'passport_photo.%' THEN 'passport_photo'
    WHEN position('-' in filename) > 0 THEN split_part(filename, '-', 1)
    ELSE regexp_replace(filename, '\.[^.]+$', '')
  END
  FROM (SELECT regexp_replace(COALESCE(path, ''), '^.*/', '') AS filename) n;
$fn$;

CREATE OR REPLACE FUNCTION public.application_canonical_doc_key(doc_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT CASE WHEN doc_key = 'passport_photo' THEN 'student_photo' ELSE doc_key END;
$fn$;

CREATE OR REPLACE FUNCTION public.application_mandatory_doc_specs(
  program_category text,
  academic_details jsonb,
  course_selections jsonb,
  social_category text
)
RETURNS TABLE(key text, label text)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_c10 text := academic_details->'class_10'->>'result_status';
  v_c12 text := academic_details->'class_12'->>'result_status';
  v_grad text := academic_details->'graduation'->>'result_status';
  v_needs_caste boolean := upper(COALESCE(social_category, '')) IN ('SC', 'ST', 'OBC');
  v_course_names text := '';
  v_is_pg boolean := COALESCE(program_category, '') IN ('postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled');
BEGIN
  IF COALESCE(program_category, '') = 'school' THEN
    IF jsonb_typeof(COALESCE(course_selections, '[]'::jsonb)) = 'array' THEN
      SELECT lower(COALESCE(string_agg(cs->>'course_name', ' '), ''))
        INTO v_course_names
        FROM jsonb_array_elements(COALESCE(course_selections, '[]'::jsonb)) cs;
    END IF;

    IF v_course_names ~* '\y(pre[-\s]?nursery|nursery)\y' THEN
      key := 'birth_certificate'; label := 'Birth Certificate'; RETURN NEXT;
    END IF;
    IF v_course_names ~* 'grade|class\s*[1-9]' THEN
      key := 'report_card'; label := 'Previous Class Report Card'; RETURN NEXT;
    END IF;
    key := 'student_photo'; label := 'Student Photograph'; RETURN NEXT;
    key := 'aadhaar'; label := 'Student Aadhaar Card'; RETURN NEXT;
    IF v_needs_caste THEN
      key := 'caste_certificate'; label := 'Caste Certificate'; RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_c10 IS DISTINCT FROM 'not_declared' THEN
    key := 'class_10_marksheet'; label := 'Class 10 Marksheet'; RETURN NEXT;
  END IF;
  IF v_c12 IS DISTINCT FROM 'not_declared' THEN
    key := 'class_12_marksheet'; label := 'Class 12 Marksheet'; RETURN NEXT;
  END IF;
  IF v_is_pg AND v_grad IS DISTINCT FROM 'not_declared' THEN
    key := 'graduation_marksheet'; label := 'Graduation Marksheet'; RETURN NEXT;
  END IF;
  key := 'aadhaar'; label := 'Student Aadhaar Card'; RETURN NEXT;
  IF v_needs_caste THEN
    key := 'caste_certificate'; label := 'Caste Certificate'; RETURN NEXT;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.compute_application_admission_doc_status(_application_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_app public.applications%ROWTYPE;
  v_docs jsonb := '[]'::jsonb;
  v_verified int := 0;
  v_rejected int := 0;
  v_pending int := 0;
  v_missing int := 0;
  v_required_total int := 0;
  v_mandatory_complete boolean := true;
  v_uploaded_total int := 0;
  v_uploaded_unverified int := 0;
  v_all_uploaded_verified boolean := false;
BEGIN
  SELECT * INTO v_app FROM public.applications WHERE application_id = _application_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'complete', false,
      'required_total', 0,
      'verified', 0,
      'rejected', 0,
      'pending', 0,
      'missing', 0,
      'docs', '[]'::jsonb
    );
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(r.status, 'pending') IS DISTINCT FROM 'verified')
    INTO v_uploaded_total, v_uploaded_unverified
    FROM (
      SELECT d.file_path
        FROM public.application_documents d
       WHERE d.application_id = _application_id
      UNION
      SELECT r.file_path
        FROM public.application_doc_reviews r
       WHERE r.application_id = _application_id
    ) files
    LEFT JOIN public.application_doc_reviews r
      ON r.application_id = _application_id AND r.file_path = files.file_path;
  v_all_uploaded_verified := v_uploaded_total > 0 AND v_uploaded_unverified = 0;

  SELECT
      COALESCE(jsonb_agg(jsonb_build_object('key', spec.key, 'label', spec.label, 'state', spec.state) ORDER BY spec.key), '[]'::jsonb),
      COUNT(*),
      COUNT(*) FILTER (WHERE spec.state = 'verified'),
      COUNT(*) FILTER (WHERE spec.state = 'rejected'),
      COUNT(*) FILTER (WHERE spec.state = 'pending'),
      COUNT(*) FILTER (WHERE spec.state = 'missing'),
      COALESCE(bool_and(spec.state = 'verified'), true)
    INTO v_docs, v_required_total, v_verified, v_rejected, v_pending, v_missing, v_mandatory_complete
    FROM (
      SELECT s.key, s.label,
             CASE
               WHEN statuses IS NULL THEN 'missing'
               WHEN statuses @> ARRAY['verified'::text] THEN 'verified'
               WHEN statuses @> ARRAY['rejected'::text] THEN 'rejected'
               ELSE 'pending'
             END AS state
        FROM public.application_mandatory_doc_specs(
               v_app.program_category,
               v_app.academic_details,
               v_app.course_selections,
               v_app.category
             ) s
        LEFT JOIN (
          SELECT public.application_canonical_doc_key(u.doc_key) AS doc_key,
                 array_agg(u.status) AS statuses
            FROM (
              SELECT public.application_canonical_doc_key(d.doc_key) AS doc_key,
                     COALESCE(r.status, 'pending') AS status
                FROM public.application_documents d
                LEFT JOIN public.application_doc_reviews r
                  ON r.application_id = d.application_id AND r.file_path = d.file_path
               WHERE d.application_id = _application_id
              UNION ALL
              SELECT public.application_canonical_doc_key(public.application_doc_key_from_path(r.file_path)),
                     r.status
                FROM public.application_doc_reviews r
               WHERE r.application_id = _application_id
                 AND NOT EXISTS (
                   SELECT 1 FROM public.application_documents d
                    WHERE d.application_id = r.application_id AND d.file_path = r.file_path
                 )
            ) u
           GROUP BY 1
        ) uploaded ON uploaded.doc_key = s.key
    ) spec;

  RETURN jsonb_build_object(
    'complete', v_mandatory_complete,
    'required_total', v_required_total,
    'verified', v_verified,
    'rejected', v_rejected,
    'pending', v_pending,
    'missing', v_missing,
    'docs', v_docs
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.refresh_application_admission_doc_status(_application_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_status jsonb;
  v_held boolean := false;
BEGIN
  SELECT COALESCE((admission_doc_status->>'held')::boolean, false)
    INTO v_held
    FROM public.applications
   WHERE application_id = _application_id;

  v_status := public.compute_application_admission_doc_status(_application_id);
  IF v_held THEN
    v_status := v_status || jsonb_build_object('held', true, 'complete', false);
  END IF;

  UPDATE public.applications
     SET mandatory_docs_complete = COALESCE((v_status->>'complete')::boolean, false),
         admission_doc_status = v_status,
         admission_doc_status_at = now()
   WHERE application_id = _application_id;
  RETURN v_status;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.lead_docs_ready_for_admission(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.lead_id = _lead_id)
      THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.applications a
       WHERE a.lead_id = _lead_id
         AND COALESCE((a.admission_doc_status->>'held')::boolean, false)
    ) THEN false
    ELSE EXISTS (
      SELECT 1
        FROM public.applications a
       WHERE a.lead_id = _lead_id
         AND (
           a.mandatory_docs_complete
           OR COALESCE((a.admission_doc_status->>'complete')::boolean, false)
           OR COALESCE((public.compute_application_admission_doc_status(a.application_id)->>'complete')::boolean, false)
         )
    )
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_pending_an_generation()
RETURNS TABLE (
  lead_id uuid, student_id uuid, name text, course text,
  pre_admission_no text, application_id text, admission_doc_status jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT l.id, s.id, s.name, c.name, s.pre_admission_no, a.application_id,
         CASE
           WHEN a.application_id IS NULL THEN a.admission_doc_status
           ELSE public.compute_application_admission_doc_status(a.application_id)
                || jsonb_build_object(
                     'held', COALESCE((a.admission_doc_status->>'held')::boolean, false)
                   )
         END
    FROM public.students s
    JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN LATERAL (
      SELECT ap.application_id, ap.admission_doc_status
        FROM public.applications ap
       WHERE ap.lead_id = l.id
       ORDER BY ap.created_at DESC NULLS LAST
       LIMIT 1
    ) a ON true
   WHERE s.pre_admission_no IS NOT NULL
     AND s.admission_no IS NULL
     AND NOT public.lead_docs_ready_for_admission(l.id)
     AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean
   ORDER BY s.name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_refresh_admission_doc_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_app_id text;
  v_lead_id uuid;
  v_was_complete boolean;
  v_now_complete boolean;
BEGIN
  v_app_id := COALESCE(NEW.application_id, OLD.application_id);
  IF v_app_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT mandatory_docs_complete INTO v_was_complete
    FROM public.applications
   WHERE application_id = v_app_id;

  PERFORM public.refresh_application_admission_doc_status(v_app_id);

  SELECT mandatory_docs_complete, lead_id
    INTO v_now_complete, v_lead_id
    FROM public.applications
   WHERE application_id = v_app_id;

  -- Only run the AN engine when completeness flips on, so listing docs
  -- (which may delete stale reviews) does not recompute fees on every view.
  IF v_lead_id IS NOT NULL AND COALESCE(v_now_complete, false) AND NOT COALESCE(v_was_complete, false) THEN
    PERFORM public.recompute_lead_fee_stage(v_lead_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_refresh_admission_doc_status_on_review ON public.application_doc_reviews;
CREATE TRIGGER trg_refresh_admission_doc_status_on_review
  AFTER INSERT OR UPDATE OR DELETE ON public.application_doc_reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_admission_doc_status();

DROP TRIGGER IF EXISTS trg_refresh_admission_doc_status_on_document ON public.application_documents;
CREATE TRIGGER trg_refresh_admission_doc_status_on_document
  AFTER INSERT OR UPDATE OR DELETE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_admission_doc_status();

GRANT EXECUTE ON FUNCTION public.compute_application_admission_doc_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_docs_ready_for_admission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_an_generation() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_issue_admission_no(_lead_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_an         text;
  v_student_id uuid;
  v_token      text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.pre_admission_no IS NULL THEN RETURN NULL; END IF;
  IF v_lead.admission_no IS NOT NULL THEN RETURN v_lead.admission_no; END IF;

  v_an := 'AN-' || UPPER(SUBSTRING(MD5(v_lead.id::text || 'an' || EXTRACT(EPOCH FROM now())::text) FROM 1 FOR 8));

  UPDATE public.students SET admission_no = COALESCE(admission_no, v_an), status = 'active'
   WHERE lead_id = v_lead.id RETURNING admission_no, id INTO v_an, v_student_id;

  UPDATE public.leads SET admission_no = v_an, stage = 'admitted' WHERE id = v_lead.id;

  INSERT INTO public.lead_activities (lead_id, type, description, new_stage)
  VALUES (v_lead.id, 'conversion', '25% fee paid — Admitted with AN: ' || v_an, 'admitted');

  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at)
    VALUES (v_student_id, v_lead.id, v_lead.phone, v_lead.email, now() + interval '30 days')
    RETURNING token INTO v_token;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_lead.id, 'system', 'Student-portal claim link generated (valid 30 days).');
  END IF;

  UPDATE public.applications
     SET admission_doc_status = COALESCE(admission_doc_status, '{}'::jsonb)
                                || jsonb_build_object('held', false)
   WHERE lead_id = v_lead.id
     AND COALESCE((admission_doc_status->>'held')::boolean, false);

  RETURN v_an;
END;
$fn$;

-- Refresh the cache, then issue ANs for anyone the live gate now considers ready.
DO $backfill$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT a.application_id, l.id AS lead_id
      FROM public.students s
      JOIN public.leads l ON l.id = s.lead_id
      JOIN LATERAL (
        SELECT ap.application_id
          FROM public.applications ap
         WHERE ap.lead_id = l.id
         ORDER BY ap.created_at DESC NULLS LAST
         LIMIT 1
      ) a ON true
     WHERE s.pre_admission_no IS NOT NULL
       AND s.admission_no IS NULL
  LOOP
    BEGIN
      PERFORM public.refresh_application_admission_doc_status(r.application_id);
      IF public.lead_docs_ready_for_admission(r.lead_id) THEN
        PERFORM public.recompute_lead_fee_stage(r.lead_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pending AN backfill skipped for %: %', r.application_id, SQLERRM;
    END;
  END LOOP;
END;
$backfill$;
