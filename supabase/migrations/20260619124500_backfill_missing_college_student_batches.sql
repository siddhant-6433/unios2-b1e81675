-- Backfill missing higher-ed student batch assignments when the course/session
-- combination resolves to exactly one configured batch.
WITH unique_course_session_batches AS (
  SELECT
    b.course_id,
    b.session_id,
    MIN(b.id) AS batch_id,
    MIN(b.name) AS batch_name,
    COUNT(*) AS batch_count
  FROM public.batches b
  GROUP BY b.course_id, b.session_id
  HAVING COUNT(*) = 1
),
updated_students AS (
  UPDATE public.students s
  SET batch_id = u.batch_id
  FROM unique_course_session_batches u
  JOIN public.courses c ON c.id = u.course_id
  WHERE s.batch_id IS NULL
    AND s.course_id = u.course_id
    AND s.session_id = u.session_id
    AND COALESCE(c.type, '') <> 'school'
  RETURNING s.id AS student_id, u.batch_id, u.batch_name
)
INSERT INTO public.student_audit_log (
  student_id,
  event_type,
  field_name,
  old_value,
  new_value,
  reason,
  metadata
)
SELECT
  student_id,
  'profile_update',
  'batch_id',
  NULL,
  batch_id::text,
  'System backfill: resolved missing higher-ed batch from course/session.',
  jsonb_build_object('batch_name', batch_name, 'source', 'course_session_unique_batch_backfill')
FROM updated_students
WHERE to_regclass('public.student_audit_log') IS NOT NULL;
