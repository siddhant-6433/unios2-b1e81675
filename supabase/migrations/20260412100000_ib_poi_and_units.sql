-- Phase 2: Programme of Inquiry + Unit Planning

-- 1. Programme of Inquiry header
CREATE TABLE public.ib_poi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institution_id, academic_year)
);

-- 2. POI entries: each cell = year-level x theme
CREATE TABLE public.ib_poi_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id uuid NOT NULL REFERENCES public.ib_poi(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id),
  theme_id uuid NOT NULL REFERENCES public.ib_td_themes(id),
  central_idea text,
  key_concepts uuid[] DEFAULT '{}',
  related_concepts text[] DEFAULT '{}',
  lines_of_inquiry text[] DEFAULT '{}',
  teacher_questions text,
  duration_weeks int DEFAULT 6,
  start_date date,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(poi_id, course_id, theme_id)
);

-- 3. Unit Plans (PYP linked to POI entries; MYP standalone)
CREATE TABLE public.ib_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  programme ib_programme NOT NULL,
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  poi_entry_id uuid REFERENCES public.ib_poi_entries(id) ON DELETE SET NULL,
  title text NOT NULL,
  central_idea text,
  statement_of_inquiry text,
  global_context_id uuid REFERENCES public.ib_global_contexts(id),
  key_concept_ids uuid[] DEFAULT '{}',
  related_concept_ids uuid[] DEFAULT '{}',
  atl_skill_ids uuid[] DEFAULT '{}',
  learner_profile_ids uuid[] DEFAULT '{}',
  subject_group_id uuid REFERENCES public.ib_myp_subject_groups(id),
  subject_focus text,
  teacher_questions text,
  inquiry_questions jsonb DEFAULT '[]',
  summative_assessment text,
  formative_assessments jsonb DEFAULT '[]',
  learning_experiences jsonb DEFAULT '[]',
  action_teaching_strategies text,
  resources jsonb DEFAULT '[]',
  reflection text,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','teaching','reflecting','completed')),
  start_date date,
  end_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Unit collaborators
CREATE TABLE public.ib_unit_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.ib_units(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL DEFAULT 'contributor' CHECK (role IN ('lead','contributor','observer')),
  UNIQUE(unit_id, user_id)
);

-- 5. Lesson Plans within a unit
CREATE TABLE public.ib_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.ib_units(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  objectives text[] DEFAULT '{}',
  activities jsonb DEFAULT '[]',
  materials text[] DEFAULT '{}',
  scheduled_date date,
  week_number int,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE public.ib_poi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_poi_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_unit_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_lessons ENABLE ROW LEVEL SECURITY;

-- POI: staff can read
CREATE POLICY "Staff read POI" ON public.ib_poi
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Coordinators manage POI" ON public.ib_poi
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

-- POI entries: staff read, coordinators + teachers write
CREATE POLICY "Staff read POI entries" ON public.ib_poi_entries
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Teachers manage POI entries" ON public.ib_poi_entries
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );

-- Units: staff can read
CREATE POLICY "Staff read units" ON public.ib_units
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Teachers create units" ON public.ib_units
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'teacher') OR
    public.has_role(auth.uid(), 'faculty')
  );
CREATE POLICY "Teachers update own units" ON public.ib_units
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    created_by = auth.uid() OR
    id IN (SELECT unit_id FROM public.ib_unit_collaborators WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins delete units" ON public.ib_units
  FOR DELETE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

-- Collaborators
CREATE POLICY "Staff read collaborators" ON public.ib_unit_collaborators
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Teachers manage collaborators" ON public.ib_unit_collaborators
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );

-- Lessons
CREATE POLICY "Staff read lessons" ON public.ib_lessons
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );
CREATE POLICY "Teachers manage lessons" ON public.ib_lessons
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher')
  );

-- ===== GRANTS =====
GRANT ALL ON public.ib_poi TO service_role;
GRANT ALL ON public.ib_poi_entries TO service_role;
GRANT ALL ON public.ib_units TO service_role;
GRANT ALL ON public.ib_unit_collaborators TO service_role;
GRANT ALL ON public.ib_lessons TO service_role;
