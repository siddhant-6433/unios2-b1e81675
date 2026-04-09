-- Phase 6: MYP Projects & Interdisciplinary Units

-- 1. Personal/Community Projects
CREATE TABLE public.ib_myp_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id),
  project_type text NOT NULL CHECK (project_type IN ('personal','community')),
  title text,
  global_context_id uuid REFERENCES public.ib_global_contexts(id),
  goal text,
  product_description text,
  process_journal jsonb DEFAULT '[]',
  supervisor_user_id uuid REFERENCES auth.users(id),
  supervisor_feedback jsonb DEFAULT '[]',
  criterion_scores jsonb DEFAULT '{}',
  final_grade int,
  presentation_date date,
  status text NOT NULL DEFAULT 'proposal' CHECK (status IN ('proposal','approved','in_progress','presentation','completed')),
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Interdisciplinary Units
CREATE TABLE public.ib_interdisciplinary_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id),
  title text NOT NULL,
  statement_of_inquiry text,
  global_context_id uuid REFERENCES public.ib_global_contexts(id),
  subject_group_1_id uuid NOT NULL REFERENCES public.ib_myp_subject_groups(id),
  subject_group_2_id uuid NOT NULL REFERENCES public.ib_myp_subject_groups(id),
  key_concept_ids uuid[] DEFAULT '{}',
  related_concept_ids uuid[] DEFAULT '{}',
  atl_skill_ids uuid[] DEFAULT '{}',
  assessment_task text,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','teaching','completed')),
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. IDU Teachers
CREATE TABLE public.ib_idu_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idu_id uuid NOT NULL REFERENCES public.ib_interdisciplinary_units(id) ON DELETE CASCADE,
  teacher_user_id uuid NOT NULL REFERENCES auth.users(id),
  subject_group_id uuid REFERENCES public.ib_myp_subject_groups(id),
  UNIQUE(idu_id, teacher_user_id)
);

-- 4. IDU Results
CREATE TABLE public.ib_idu_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idu_id uuid NOT NULL REFERENCES public.ib_interdisciplinary_units(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  criterion_a int CHECK (criterion_a BETWEEN 0 AND 8),
  criterion_b int CHECK (criterion_b BETWEEN 0 AND 8),
  criterion_c int CHECK (criterion_c BETWEEN 0 AND 8),
  total int,
  teacher_comment text,
  UNIQUE(idu_id, student_id)
);

-- ===== RLS =====
ALTER TABLE public.ib_myp_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_interdisciplinary_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_idu_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_idu_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read projects" ON public.ib_myp_projects
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Manage projects" ON public.ib_myp_projects
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff read IDU" ON public.ib_interdisciplinary_units
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage IDU" ON public.ib_interdisciplinary_units
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

CREATE POLICY "Staff read IDU teachers" ON public.ib_idu_teachers
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage IDU teachers" ON public.ib_idu_teachers
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

CREATE POLICY "Staff read IDU results" ON public.ib_idu_results
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Teachers manage IDU results" ON public.ib_idu_results
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );

GRANT ALL ON public.ib_myp_projects TO service_role;
GRANT ALL ON public.ib_interdisciplinary_units TO service_role;
GRANT ALL ON public.ib_idu_teachers TO service_role;
GRANT ALL ON public.ib_idu_results TO service_role;
