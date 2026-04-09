-- Phase 3: Assessment & Gradebook

-- 1. Assessment Tasks
CREATE TABLE public.ib_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES public.ib_units(id) ON DELETE SET NULL,
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  programme ib_programme NOT NULL,
  title text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('formative','summative')),
  subject text,
  subject_group_id uuid REFERENCES public.ib_myp_subject_groups(id),
  grading_model text NOT NULL DEFAULT 'rubric' CHECK (grading_model IN ('rubric','criteria','anecdotal','points','checklist')),
  max_points int,
  rubric jsonb,
  due_date date,
  assigned_date date,
  created_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','grading','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Assessment Results
CREATE TABLE public.ib_assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.ib_assessments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  points_earned int,
  rubric_level int,
  anecdotal_comment text,
  criterion_scores jsonb DEFAULT '{}',
  criterion_total int,
  myp_grade int CHECK (myp_grade BETWEEN 1 AND 7),
  teacher_comment text,
  atl_skill_ids uuid[] DEFAULT '{}',
  learner_profile_ids uuid[] DEFAULT '{}',
  submitted_at timestamptz,
  graded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(assessment_id, student_id)
);

-- 3. MYP Grade Boundaries
CREATE TABLE public.ib_myp_grade_boundaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_group_id uuid NOT NULL REFERENCES public.ib_myp_subject_groups(id),
  academic_year text NOT NULL,
  grade_1_min int NOT NULL DEFAULT 1,
  grade_2_min int NOT NULL DEFAULT 5,
  grade_3_min int NOT NULL DEFAULT 9,
  grade_4_min int NOT NULL DEFAULT 13,
  grade_5_min int NOT NULL DEFAULT 17,
  grade_6_min int NOT NULL DEFAULT 21,
  grade_7_min int NOT NULL DEFAULT 25,
  UNIQUE(subject_group_id, academic_year)
);

-- Seed default boundaries for all subject groups for 2026-27
INSERT INTO public.ib_myp_grade_boundaries (subject_group_id, academic_year)
SELECT id, '2026-27' FROM public.ib_myp_subject_groups;

-- 4. Gradebook Snapshots (term aggregation for report cards)
CREATE TABLE public.ib_gradebook_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id),
  programme ib_programme NOT NULL,
  academic_year text NOT NULL,
  term text NOT NULL,
  subject text,
  overall_comment text,
  achievement_level text,
  subject_group_id uuid REFERENCES public.ib_myp_subject_groups(id),
  criterion_scores jsonb DEFAULT '{}',
  final_grade int,
  atl_assessment jsonb DEFAULT '{}',
  learner_profile_notes jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, batch_id, term, subject, academic_year)
);

-- 5. MYP Grade Computation Function
CREATE OR REPLACE FUNCTION public.compute_myp_grade(
  _criterion_total int,
  _subject_group_id uuid,
  _academic_year text
) RETURNS int
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN _criterion_total >= gb.grade_7_min THEN 7
    WHEN _criterion_total >= gb.grade_6_min THEN 6
    WHEN _criterion_total >= gb.grade_5_min THEN 5
    WHEN _criterion_total >= gb.grade_4_min THEN 4
    WHEN _criterion_total >= gb.grade_3_min THEN 3
    WHEN _criterion_total >= gb.grade_2_min THEN 2
    WHEN _criterion_total >= gb.grade_1_min THEN 1
    ELSE 1
  END
  FROM public.ib_myp_grade_boundaries gb
  WHERE gb.subject_group_id = _subject_group_id
    AND gb.academic_year = _academic_year
  LIMIT 1;
$$;

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE public.ib_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_myp_grade_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_gradebook_snapshots ENABLE ROW LEVEL SECURITY;

-- Assessments: staff read, teachers create/edit own
CREATE POLICY "Staff read assessments" ON public.ib_assessments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Teachers manage assessments" ON public.ib_assessments
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    created_by = auth.uid()
  );

-- Results: staff read/write, students read own
CREATE POLICY "Staff read results" ON public.ib_assessment_results
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Teachers manage results" ON public.ib_assessment_results
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );

-- Grade boundaries: admins manage
CREATE POLICY "Staff read boundaries" ON public.ib_myp_grade_boundaries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage boundaries" ON public.ib_myp_grade_boundaries
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

-- Gradebook snapshots: staff manage, students read own
CREATE POLICY "Staff manage snapshots" ON public.ib_gradebook_snapshots
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Students read own snapshots" ON public.ib_gradebook_snapshots
  FOR SELECT TO authenticated USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );

-- ===== GRANTS =====
GRANT ALL ON public.ib_assessments TO service_role;
GRANT ALL ON public.ib_assessment_results TO service_role;
GRANT ALL ON public.ib_myp_grade_boundaries TO service_role;
GRANT ALL ON public.ib_gradebook_snapshots TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_myp_grade TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_myp_grade TO service_role;
