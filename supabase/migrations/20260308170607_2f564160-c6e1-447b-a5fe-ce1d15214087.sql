
-- Daily attendance table
CREATE TABLE public.daily_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id),
  date date NOT NULL,
  status text NOT NULL DEFAULT 'present',
  subject text,
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, date, subject)
);

ALTER TABLE public.daily_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage attendance" ON public.daily_attendance
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin') OR
    has_role(auth.uid(), 'campus_admin') OR
    has_role(auth.uid(), 'faculty') OR
    has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Students can view own attendance" ON public.daily_attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM students s WHERE s.id = daily_attendance.student_id AND s.user_id = auth.uid())
  );

-- Exam records table
CREATE TABLE public.exam_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject text NOT NULL,
  exam_type text NOT NULL DEFAULT 'mid_term',
  max_marks integer NOT NULL,
  obtained_marks integer NOT NULL DEFAULT 0,
  grade text,
  exam_date date,
  batch_id uuid REFERENCES public.batches(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exam_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage exam records" ON public.exam_records
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin') OR
    has_role(auth.uid(), 'campus_admin') OR
    has_role(auth.uid(), 'faculty') OR
    has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Students can view own exams" ON public.exam_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM students s WHERE s.id = exam_records.student_id AND s.user_id = auth.uid())
  );
