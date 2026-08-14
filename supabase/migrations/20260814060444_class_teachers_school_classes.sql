-- Let a class teacher be assigned to a SCHOOL class, not just a college batch.
--
-- class_teachers keyed only on batch_id, and is_class_teacher_of() joined
-- st.batch_id = ct.batch_id. But `batches` holds ~5 rows, all college
-- programmes, covering ~10 of 350 students. Every Grade I-XII student has
-- batch_id NULL, so the join could never match and no class teacher could be
-- assigned to a school grade -- the exact case the feature exists for.
--
-- School class identity is course_id (Grade IV) + section + session_id.
-- College class identity is batch_id (+ optional section). One table covers
-- both: exactly one of batch_id / course_id is set, and the matcher checks
-- whichever is present.
--
-- Safe: class_teachers is still empty in prod.

-- ---------------------------------------------------------------------------
-- 1. Widen the key
-- ---------------------------------------------------------------------------

ALTER TABLE public.class_teachers
  ALTER COLUMN batch_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Exactly one of batch_id / course_id. Without this a row with both set would
-- silently widen the teacher's scope across two different classes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'class_teachers_one_target'
  ) THEN
    ALTER TABLE public.class_teachers
      ADD CONSTRAINT class_teachers_one_target
      CHECK (num_nonnulls(batch_id, course_id) = 1);
  END IF;
END $$;

-- The old unique index assumed batch_id was present. Replace with one per
-- target so (teacher, Grade IV, section A, 2026-27) can't be entered twice.
DROP INDEX IF EXISTS public.class_teachers_unique;
CREATE UNIQUE INDEX IF NOT EXISTS class_teachers_unique_batch
  ON public.class_teachers (teacher_user_id, batch_id, section, session_id)
  NULLS NOT DISTINCT
  WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS class_teachers_unique_course
  ON public.class_teachers (teacher_user_id, course_id, section, session_id)
  NULLS NOT DISTINCT
  WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS class_teachers_course_idx
  ON public.class_teachers (course_id) WHERE active;

-- ---------------------------------------------------------------------------
-- 2. Match on whichever target the row carries
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_class_teacher_of(_user_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.class_teachers ct
      ON ct.active
     AND ct.teacher_user_id = _user_id
     -- college: batch-keyed. school: course-keyed (Grade IV + section).
     AND (
          (ct.batch_id  IS NOT NULL AND ct.batch_id  = st.batch_id)
       OR (ct.course_id IS NOT NULL AND ct.course_id = st.course_id)
     )
     AND (ct.section    IS NULL OR ct.section    = st.section)
     AND (ct.session_id IS NULL OR ct.session_id = st.session_id)
    WHERE st.id = _student_id
  );
$$;

COMMENT ON FUNCTION public.is_class_teacher_of(uuid, uuid) IS
  'Nodal check: is this user the class teacher of the student''s class? Matches a college batch or a school course+section.';

-- ---------------------------------------------------------------------------
-- 3. Same for the subject teacher
-- ---------------------------------------------------------------------------
-- subject_allocations.batch_id is already nullable, and subjects carry
-- course_id, so a school subject teacher is reachable through the subject's
-- course when no batch is set. Without this branch a subject teacher of
-- Grade IV would match nothing either.

CREATE OR REPLACE FUNCTION public.teaches_subject_of(_user_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students st
    JOIN public.subject_allocations sa
      ON sa.active
     AND sa.faculty_user_id = _user_id
     AND (
          (sa.batch_id IS NOT NULL AND sa.batch_id = st.batch_id)
       OR (sa.batch_id IS NULL AND EXISTS (
             SELECT 1 FROM public.subjects sub
             WHERE sub.id = sa.subject_id
               AND sub.course_id = st.course_id
           ))
     )
     AND (sa.section    IS NULL OR sa.section    = st.section)
     AND (sa.session_id IS NULL OR sa.session_id = st.session_id)
    WHERE st.id = _student_id
  );
$$;
