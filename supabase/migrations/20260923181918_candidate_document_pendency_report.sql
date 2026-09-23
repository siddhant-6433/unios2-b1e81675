-- candidate document pendency report
CREATE OR REPLACE FUNCTION public.candidate_document_pendency_report(_campus_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
WITH application_rows AS (
  SELECT
    ('application:' || a.id::text) AS candidate_key,
    a.id AS application_row_id,
    NULL::uuid AS student_id,
    a.application_id,
    NULL::text AS admission_no,
    NULL::text AS pre_admission_no,
    CASE
      WHEN l.pre_admission_no IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.students ps
        WHERE ps.lead_id = a.lead_id
          AND ps.pre_admission_no IS NOT NULL
          AND ps.admission_no IS NULL
          AND ps.deleted_at IS NULL
      ) THEN 'pre_admitted'
      ELSE 'application'
    END AS candidate_stage,
    a.full_name AS name,
    a.phone,
    campus.id AS campus_id,
    campus.name AS campus_name,
    CASE
      WHEN NULLIF(a.course_selections->0->>'course_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NULLIF(a.course_selections->0->>'course_id', '')::uuid
      ELSE NULL
    END AS course_id,
    COALESCE(NULLIF(a.course_selections->0->>'course_name', ''), course.name) AS course_name,
    CASE WHEN a.program_category = 'school'
      THEN COALESCE(NULLIF(a.course_selections->0->>'course_name', ''), course.name)
      ELSE NULL
    END AS grade,
    a.program_category,
    COALESCE(a.admission_doc_status, public.compute_application_admission_doc_status(a.application_id)) AS doc_status,
    COALESCE(uploaded.uploads, '[]'::jsonb) AS uploaded_docs,
    COALESCE(uploaded.uploaded_count, 0) AS uploaded_count
  FROM public.applications a
  LEFT JOIN public.leads l ON l.id = a.lead_id
  LEFT JOIN public.campuses campus
    ON campus.id = public.application_branch_campus_id(a.lead_id, a.course_selections)
  LEFT JOIN public.courses course
    ON course.id = CASE
      WHEN NULLIF(a.course_selections->0->>'course_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NULLIF(a.course_selections->0->>'course_id', '')::uuid
      ELSE NULL
    END
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS uploaded_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'key', public.application_canonical_doc_key(d.doc_key),
            'label', COALESCE(spec.label, replace(public.application_canonical_doc_key(d.doc_key), '_', ' ')),
            'status', COALESCE(r.status, 'pending'),
            'file_name', COALESCE(NULLIF(d.original_file_name, ''), d.file_name),
            'uploaded_at', d.uploaded_at
          )
          ORDER BY d.uploaded_at DESC, d.file_name
        ),
        '[]'::jsonb
      ) AS uploads
    FROM public.application_documents d
    LEFT JOIN public.application_doc_reviews r
      ON r.application_id = d.application_id AND r.file_path = d.file_path
    LEFT JOIN public.application_mandatory_doc_specs(
      a.program_category,
      a.academic_details,
      a.course_selections,
      a.category
    ) spec
      ON spec.key = public.application_canonical_doc_key(d.doc_key)
    WHERE d.application_id = a.application_id
  ) uploaded ON true
  WHERE (a.status IS NULL OR a.status NOT IN ('deleted', 'rejected'))
    AND (
      campus.id IS NULL
      OR public.user_can_access_record_campus(auth.uid(), campus.id)
    )
    AND (
      _campus_ids IS NULL
      OR array_length(_campus_ids, 1) IS NULL
      OR campus.id = ANY(_campus_ids)
    )
),
student_rows AS (
  SELECT
    ('student:' || s.id::text) AS candidate_key,
    NULL::uuid AS application_row_id,
    s.id AS student_id,
    app.application_id,
    s.admission_no,
    s.pre_admission_no,
    CASE WHEN s.admission_no IS NOT NULL THEN 'admitted' ELSE 'pre_admitted' END AS candidate_stage,
    s.name,
    COALESCE(s.phone, s.whatsapp_no, s.student_email) AS phone,
    campus.id AS campus_id,
    campus.name AS campus_name,
    s.course_id,
    COALESCE(course.name, s.joining_class, s.previous_class) AS course_name,
    CASE
      WHEN course.kind = 'school' OR course.type = 'school' OR s.joining_class IS NOT NULL
        THEN COALESCE(s.joining_class, course.name, s.previous_class)
      ELSE NULL
    END AS grade,
    CASE WHEN course.kind = 'school' OR course.type = 'school' THEN 'school' ELSE NULL END AS program_category,
    jsonb_build_object(
      'complete', COALESCE(uploaded.uploaded_count, 0) > 0,
      'required_total', 0,
      'verified', COALESCE(uploaded.uploaded_count, 0),
      'rejected', 0,
      'pending', 0,
      'missing', CASE WHEN COALESCE(uploaded.uploaded_count, 0) = 0 THEN 1 ELSE 0 END,
      'docs', CASE
        WHEN COALESCE(uploaded.uploaded_count, 0) = 0
          THEN jsonb_build_array(jsonb_build_object('key', 'student_documents', 'label', 'Student Documents', 'state', 'missing'))
        ELSE uploaded.uploads
      END
    ) AS doc_status,
    COALESCE(uploaded.uploads, '[]'::jsonb) AS uploaded_docs,
    COALESCE(uploaded.uploaded_count, 0) AS uploaded_count
  FROM public.students s
  LEFT JOIN public.campuses campus ON campus.id = s.campus_id
  LEFT JOIN public.courses course ON course.id = s.course_id
  LEFT JOIN LATERAL (
    SELECT a.application_id
    FROM public.applications a
    WHERE a.lead_id = s.lead_id
    ORDER BY a.created_at DESC
    LIMIT 1
  ) app ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS uploaded_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'key', lower(regexp_replace(sd.document_name, '[^a-zA-Z0-9]+', '_', 'g')),
            'label', sd.document_name,
            'status', 'uploaded',
            'file_name', sd.file_name,
            'uploaded_at', sd.uploaded_at
          )
          ORDER BY sd.uploaded_at DESC NULLS LAST, sd.document_name
        ),
        '[]'::jsonb
      ) AS uploads
    FROM public.student_documents sd
    WHERE sd.student_id = s.id
  ) uploaded ON true
  WHERE s.deleted_at IS NULL
    AND (s.admission_no IS NOT NULL OR s.pre_admission_no IS NOT NULL)
    AND (
      campus.id IS NULL
      OR public.user_can_access_record_campus(auth.uid(), campus.id)
    )
    AND (
      _campus_ids IS NULL
      OR array_length(_campus_ids, 1) IS NULL
      OR campus.id = ANY(_campus_ids)
    )
),
combined AS (
  SELECT * FROM application_rows
  UNION ALL
  SELECT * FROM student_rows
),
normalized AS (
  SELECT
    c.*,
    COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN doc ? 'state' THEN doc
          ELSE jsonb_build_object(
            'key', doc->>'key',
            'label', doc->>'label',
            'state', COALESCE(doc->>'status', 'uploaded'),
            'file_name', doc->>'file_name',
            'uploaded_at', doc->>'uploaded_at'
          )
        END
        ORDER BY COALESCE(doc->>'label', doc->>'key')
      )
      FROM jsonb_array_elements(COALESCE(c.doc_status->'docs', '[]'::jsonb)) doc
    ), '[]'::jsonb) AS documents,
    COALESCE((
      SELECT jsonb_agg(doc->>'label' ORDER BY doc->>'label')
      FROM jsonb_array_elements(COALESCE(c.doc_status->'docs', '[]'::jsonb)) doc
      WHERE COALESCE(doc->>'state', '') IN ('missing', 'pending', 'rejected')
    ), '[]'::jsonb) AS pending_documents,
    COALESCE((
      SELECT jsonb_agg(doc->>'file_name' ORDER BY doc->>'file_name')
      FROM jsonb_array_elements(c.uploaded_docs) doc
      WHERE COALESCE(doc->>'file_name', '') <> ''
    ), '[]'::jsonb) AS uploaded_file_names
  FROM combined c
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'rows', COALESCE(jsonb_agg(
    jsonb_build_object(
      'candidate_key', candidate_key,
      'application_id', application_id,
      'student_id', student_id,
      'admission_no', admission_no,
      'pre_admission_no', pre_admission_no,
      'candidate_stage', candidate_stage,
      'name', name,
      'phone', phone,
      'campus_id', campus_id,
      'campus_name', campus_name,
      'course_id', course_id,
      'course_name', course_name,
      'grade', grade,
      'program_category', program_category,
      'document_upload', CASE WHEN uploaded_count > 0 THEN 'Yes' ELSE 'No' END,
      'uploaded_count', uploaded_count,
      'required_total', COALESCE((doc_status->>'required_total')::int, 0),
      'verified_count', COALESCE((doc_status->>'verified')::int, 0),
      'pending_count', COALESCE((doc_status->>'pending')::int, 0),
      'rejected_count', COALESCE((doc_status->>'rejected')::int, 0),
      'missing_count', COALESCE((doc_status->>'missing')::int, 0),
      'complete', COALESCE((doc_status->>'complete')::boolean, false),
      'uploaded_file_names', uploaded_file_names,
      'pending_documents', pending_documents,
      'documents', documents
    )
    ORDER BY campus_name NULLS LAST, COALESCE(grade, course_name) NULLS LAST, name
  ), '[]'::jsonb)
)
FROM normalized;
$fn$;

GRANT EXECUTE ON FUNCTION public.candidate_document_pendency_report(uuid[]) TO authenticated;
