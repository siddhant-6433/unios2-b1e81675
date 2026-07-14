-- Student academic segmentation cleanup.
--
-- Schools: class/grade belongs to the course, and every school student must
-- carry an academic session plus admission date/year for backend reporting.
-- Higher-ed: current semester/year is a backend field on students.

INSERT INTO public.admission_sessions (id, name, start_date, end_date, is_active)
VALUES
  ('f0000001-0000-0000-0000-000000000001'::uuid, '2026-27', DATE '2026-04-01', DATE '2027-03-31', true),
  ('f0000001-0000-0000-0000-000000000002'::uuid, '2027-28', DATE '2027-04-01', DATE '2028-03-31', true)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    is_active = true;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS semester text;

COMMENT ON COLUMN public.students.semester IS
  'Backend-only current semester/year label for higher-ed students, e.g. Sem 1, Year 2.';

CREATE OR REPLACE FUNCTION public.student_course_is_school(_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.departments d ON d.id = c.department_id
    JOIN public.institutions i ON i.id = d.institution_id
    WHERE c.id = _course_id
      AND i.type = 'school'
  );
$$;

-- Existing school data defaults to 2026-27.
UPDATE public.students s
SET session_id = 'f0000001-0000-0000-0000-000000000001'::uuid
WHERE s.session_id IS NULL
  AND public.student_course_is_school(s.course_id);

UPDATE public.students s
SET joining_academic_year = '2026-27'
WHERE COALESCE(NULLIF(BTRIM(s.joining_academic_year), ''), '') = ''
  AND public.student_course_is_school(s.course_id);

-- Use the row's creation date as a conservative backend admission date when
-- existing school imports did not carry one.
UPDATE public.students s
SET admission_date = s.created_at::date
WHERE s.admission_date IS NULL
  AND public.student_course_is_school(s.course_id);

CREATE OR REPLACE FUNCTION public.enforce_school_student_academic_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.student_course_is_school(NEW.course_id) THEN
    IF NEW.session_id IS NULL THEN
      RAISE EXCEPTION 'School students require an academic session';
    END IF;
    IF NEW.admission_date IS NULL THEN
      RAISE EXCEPTION 'School students require an admission date';
    END IF;
    IF COALESCE(NULLIF(BTRIM(NEW.joining_academic_year), ''), '') = '' THEN
      RAISE EXCEPTION 'School students require an admission year';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_school_student_academic_fields ON public.students;
CREATE TRIGGER trg_enforce_school_student_academic_fields
  BEFORE INSERT OR UPDATE OF course_id, session_id, admission_date, joining_academic_year
  ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_school_student_academic_fields();
