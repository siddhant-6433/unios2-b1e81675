-- One-time backfill: give existing college students a batch.
--
-- Bulk import historically set session_id but never batch_id, so ~221 college
-- students (all session 2026-27) had no batch and were invisible to the Fee
-- Dues report's Batch filter. This creates a batch per (course, session) via
-- get_or_create_batch and assigns it.
--
-- Batch name = admissionYear-gradYear. Default admission year = the session's
-- start year (2026); grad year = start + course duration_years. The Kotputli
-- B.Ed cohort was IMPORTED as the 2025-27 batch (admitted 2025), confirmed by
-- the director, so that one course is overridden. Every other college course's
-- default already matches its true intake (e.g. Greater Noida B.Ed 2026-28).
--
-- School students are excluded (they use joining_academic_year, not batches):
-- guarded two ways — joining_academic_year IS NULL and a course-name check.
-- Idempotent: WHERE batch_id IS NULL means a re-run assigns 0 rows.

DO $$
DECLARE
  r record;
  v_bid uuid;
  v_name text;
BEGIN
  FOR r IN
    SELECT s.course_id, s.session_id, co.duration_years AS dur,
           substring(ase.name from '^\d{4}')::int AS sess_start
    FROM public.students s
    JOIN public.courses co ON co.id = s.course_id
    JOIN public.admission_sessions ase ON ase.id = s.session_id
    WHERE s.batch_id IS NULL
      AND s.course_id IS NOT NULL
      AND s.session_id IS NOT NULL
      AND s.joining_academic_year IS NULL            -- exclude school cohorts
      AND co.name !~* '^(grade|nursery|lkg|ukg)'     -- belt-and-suspenders
    GROUP BY s.course_id, s.session_id, co.duration_years, ase.name
  LOOP
    IF r.course_id = 'a0000001-0000-0000-0000-000000000020' THEN
      v_name := '2025-27';  -- Kotputli B.Ed imported cohort (director-confirmed)
    ELSE
      v_name := r.sess_start || '-' || lpad(((r.sess_start + r.dur) % 100)::text, 2, '0');
    END IF;

    v_bid := public.get_or_create_batch(r.course_id, r.session_id, v_name);
    IF v_bid IS NULL THEN CONTINUE; END IF;

    UPDATE public.students
       SET batch_id = v_bid
     WHERE course_id = r.course_id
       AND session_id = r.session_id
       AND batch_id IS NULL
       AND joining_academic_year IS NULL;
  END LOOP;
END $$;
