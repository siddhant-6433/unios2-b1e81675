-- Phase 4: Portfolios, Action/Service, Exhibition

-- 1. Portfolio Entries
CREATE TABLE public.ib_portfolio_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  programme ib_programme NOT NULL,
  title text NOT NULL,
  description text,
  entry_type text NOT NULL CHECK (entry_type IN ('artifact','reflection','photo','video','document','presentation')),
  unit_id uuid REFERENCES public.ib_units(id) ON DELETE SET NULL,
  atl_skill_ids uuid[] DEFAULT '{}',
  learner_profile_ids uuid[] DEFAULT '{}',
  key_concept_ids uuid[] DEFAULT '{}',
  file_urls jsonb DEFAULT '[]',
  content_text text,
  teacher_comment text,
  is_exhibition boolean DEFAULT false,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','teachers','parents','public')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. PYP Action Journal
CREATE TABLE public.ib_action_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  action_type text CHECK (action_type IN ('participation','advocacy','social_justice','social_entrepreneurship','lifestyle_choice')),
  evidence_urls jsonb DEFAULT '[]',
  learner_profile_ids uuid[] DEFAULT '{}',
  unit_id uuid REFERENCES public.ib_units(id) ON DELETE SET NULL,
  teacher_comment text,
  approved_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. MYP Service as Action
CREATE TABLE public.ib_service_as_action (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  activity_type text CHECK (activity_type IN ('service','action','service_as_action')),
  learning_outcomes jsonb DEFAULT '{}',
  reflections jsonb DEFAULT '[]',
  supervisor_name text,
  supervisor_comment text,
  hours_completed numeric(6,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','in_progress','completed','verified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. PYP Exhibition
CREATE TABLE public.ib_exhibitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  title text,
  issue text,
  td_theme_id uuid REFERENCES public.ib_td_themes(id),
  central_idea text,
  mentor_user_id uuid REFERENCES auth.users(id),
  research_notes text,
  action_plan text,
  presentation_date date,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','research','action','presentation','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ib_exhibition_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exhibition_id uuid NOT NULL REFERENCES public.ib_exhibitions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  UNIQUE(exhibition_id, student_id)
);

-- ===== RLS =====
ALTER TABLE public.ib_portfolio_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_action_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_service_as_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_exhibitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_exhibition_students ENABLE ROW LEVEL SECURITY;

-- Portfolio: staff read all, students read own + parents read child's
CREATE POLICY "Staff read portfolios" ON public.ib_portfolio_entries
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Students read own portfolio" ON public.ib_portfolio_entries
  FOR SELECT TO authenticated USING (
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Staff and students manage portfolios" ON public.ib_portfolio_entries
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    created_by = auth.uid()
  );

-- Action journal
CREATE POLICY "Staff read action_journal" ON public.ib_action_journal
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Manage action_journal" ON public.ib_action_journal
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );

-- Service as action
CREATE POLICY "Staff read service" ON public.ib_service_as_action
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );
CREATE POLICY "Manage service" ON public.ib_service_as_action
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
  );

-- Exhibitions
CREATE POLICY "Staff read exhibitions" ON public.ib_exhibitions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage exhibitions" ON public.ib_exhibitions
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );
CREATE POLICY "Staff read exhibition_students" ON public.ib_exhibition_students
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage exhibition_students" ON public.ib_exhibition_students
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

-- ===== GRANTS =====
GRANT ALL ON public.ib_portfolio_entries TO service_role;
GRANT ALL ON public.ib_action_journal TO service_role;
GRANT ALL ON public.ib_service_as_action TO service_role;
GRANT ALL ON public.ib_exhibitions TO service_role;
GRANT ALL ON public.ib_exhibition_students TO service_role;
