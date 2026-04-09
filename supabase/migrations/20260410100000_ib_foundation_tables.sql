-- Phase 1: IB Foundation & Reference Data
-- Creates all IB-specific reference tables for PYP and MYP programmes
-- NOTE: ib_programme enum and ib_coordinator role are created in 20260409100000_add_ib_coordinator_role.sql

-- 1. Add MYP department and courses to Mirai
DO $$
DECLARE
  v_inst_id uuid;
  v_myp_dept_id uuid;
  v_course_id uuid;
BEGIN
  SELECT id INTO v_inst_id FROM public.institutions WHERE code = 'GZ1-MES';

  -- Skip if Mirai institution doesn't exist yet
  IF v_inst_id IS NULL THEN
    RAISE NOTICE 'MES institution not found, skipping MYP department/course creation';
    RETURN;
  END IF;

  INSERT INTO public.departments (institution_id, name, code)
  VALUES (v_inst_id, 'Middle Years Programme', 'MYP')
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_myp_dept_id FROM public.departments
  WHERE institution_id = v_inst_id AND code = 'MYP';

  IF v_myp_dept_id IS NULL THEN
    RAISE NOTICE 'MYP department not created, skipping courses';
    RETURN;
  END IF;

  -- MYP 1 (Grade VI) through MYP 3 (Grade VIII)
  INSERT INTO public.courses (department_id, name, code, duration_years, type) VALUES
    (v_myp_dept_id, 'MYP 1 (Grade VI)',   'MES-MYP1', 1, 'annual'),
    (v_myp_dept_id, 'MYP 2 (Grade VII)',  'MES-MYP2', 1, 'annual'),
    (v_myp_dept_id, 'MYP 3 (Grade VIII)', 'MES-MYP3', 1, 'annual')
  ON CONFLICT (code) DO NOTHING;

  -- Eligibility rules for MYP courses
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MES-MYP1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, notes)
    VALUES (v_course_id, 11, 'Minimum age: 11 years plus')
    ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;
  END IF;

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MES-MYP2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, notes)
    VALUES (v_course_id, 12, 'Minimum age: 12 years plus')
    ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;
  END IF;

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MES-MYP3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, notes)
    VALUES (v_course_id, 13, 'Minimum age: 13 years plus')
    ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;
  END IF;
END $$;

-- 4. Learner Profile attributes (shared PYP + MYP)
CREATE TABLE public.ib_learner_profile_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.ib_learner_profile_attributes (name, description, sort_order) VALUES
  ('Inquirers',      'Nurturing curiosity, developing skills for inquiry and research.', 1),
  ('Knowledgeable',  'Developing and using conceptual understanding across disciplines.', 2),
  ('Thinkers',       'Using critical and creative thinking skills to analyse and act.', 3),
  ('Communicators',  'Expressing ideas confidently and creatively in multiple modes.', 4),
  ('Principled',     'Acting with integrity and honesty, with fairness and justice.', 5),
  ('Open-minded',    'Critically appreciating own cultures and personal histories, and values of others.', 6),
  ('Caring',         'Showing empathy, compassion and respect.', 7),
  ('Risk-takers',    'Approaching uncertainty with forethought and determination.', 8),
  ('Balanced',       'Understanding the importance of balancing different aspects of our lives.', 9),
  ('Reflective',     'Thoughtfully considering the world and our own ideas and experience.', 10);

-- 5. ATL Skill Categories
CREATE TABLE public.ib_atl_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  programme ib_programme,  -- NULL = both
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE public.ib_atl_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.ib_atl_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  descriptor text,
  programme ib_programme,  -- NULL = both
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.ib_atl_categories (name, sort_order) VALUES
  ('Thinking skills', 1),
  ('Communication skills', 2),
  ('Social skills', 3),
  ('Self-management skills', 4),
  ('Research skills', 5);

-- Thinking sub-skills
INSERT INTO public.ib_atl_skills (category_id, name, descriptor, sort_order) VALUES
  ((SELECT id FROM ib_atl_categories WHERE name = 'Thinking skills'), 'Critical thinking', 'Analysing and evaluating issues and ideas', 1),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Thinking skills'), 'Creative thinking', 'Generating novel ideas and considering new perspectives', 2),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Thinking skills'), 'Transfer', 'Using skills and knowledge in multiple contexts', 3);

-- Communication sub-skills
INSERT INTO public.ib_atl_skills (category_id, name, descriptor, sort_order) VALUES
  ((SELECT id FROM ib_atl_categories WHERE name = 'Communication skills'), 'Literacy', 'Reading, writing and using language to gather and communicate information', 1),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Communication skills'), 'ICT', 'Using technology to gather, investigate and communicate information', 2);

-- Social sub-skills
INSERT INTO public.ib_atl_skills (category_id, name, descriptor, sort_order) VALUES
  ((SELECT id FROM ib_atl_categories WHERE name = 'Social skills'), 'Collaboration', 'Working effectively with others', 1);

-- Self-management sub-skills
INSERT INTO public.ib_atl_skills (category_id, name, descriptor, sort_order) VALUES
  ((SELECT id FROM ib_atl_categories WHERE name = 'Self-management skills'), 'Organisation', 'Managing time and tasks effectively', 1),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Self-management skills'), 'Affective', 'Managing state of mind — mindfulness, perseverance, resilience', 2),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Self-management skills'), 'Reflection', 'Reconsidering the process of learning and considering personal learning strategies', 3);

-- Research sub-skills
INSERT INTO public.ib_atl_skills (category_id, name, descriptor, sort_order) VALUES
  ((SELECT id FROM ib_atl_categories WHERE name = 'Research skills'), 'Information literacy', 'Finding, interpreting, judging and creating information', 1),
  ((SELECT id FROM ib_atl_categories WHERE name = 'Research skills'), 'Media literacy', 'Interacting with media to use and create ideas and information', 2);

-- 6. Key Concepts
CREATE TABLE public.ib_key_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  programme ib_programme NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE(name, programme)
);

-- PYP 7 Key Concepts
INSERT INTO public.ib_key_concepts (name, description, programme, sort_order) VALUES
  ('Form',           'What is it like?',                          'pyp', 1),
  ('Function',       'How does it work?',                         'pyp', 2),
  ('Causation',      'Why is it like it is?',                     'pyp', 3),
  ('Change',         'How is it changing?',                       'pyp', 4),
  ('Connection',     'How is it connected to other things?',      'pyp', 5),
  ('Perspective',    'What are the points of view?',              'pyp', 6),
  ('Responsibility', 'What is our responsibility?',               'pyp', 7);

-- MYP 16 Key Concepts
INSERT INTO public.ib_key_concepts (name, description, programme, sort_order) VALUES
  ('Aesthetics',          'Deals with beauty, taste and the creation and appreciation of beauty.', 'myp', 1),
  ('Change',              'A conversion, transformation, or movement from one form, state or value to another.', 'myp', 2),
  ('Communication',       'The exchange or transfer of signals, facts, ideas and symbols.', 'myp', 3),
  ('Communities',         'Groups that exist in proximity defined by space, time, or relationship.', 'myp', 4),
  ('Connections',         'Links, bonds and relationships among people, objects, organisms or ideas.', 'myp', 5),
  ('Creativity',          'The process of generating novel ideas and considering existing ideas from new perspectives.', 'myp', 6),
  ('Culture',             'A range of learned and shared beliefs, values, interests, attitudes, products and patterns of behaviour.', 'myp', 7),
  ('Development',         'The act or process of growth, progress or evolution, sometimes through iterative improvements.', 'myp', 8),
  ('Form',                'The shape and underlying structure of an entity or piece of work.', 'myp', 9),
  ('Global interactions', 'The connections among individuals and communities worldwide.', 'myp', 10),
  ('Identity',            'The state or fact of being the same; who or what a person or thing is.', 'myp', 11),
  ('Logic',               'A method of reasoning and a system of principles used to build arguments and reach conclusions.', 'myp', 12),
  ('Perspective',         'The position from which we observe situations, objects, facts, ideas and opinions.', 'myp', 13),
  ('Relationships',       'The connections and associations between properties, objects, people and ideas.', 'myp', 14),
  ('Systems',             'Sets of interacting or interdependent components.', 'myp', 15),
  ('Time, place and space', 'The absolute or relative position of people, objects and ideas.', 'myp', 16);

-- 7. Transdisciplinary Themes (PYP)
CREATE TABLE public.ib_td_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  central_idea_prompt text,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.ib_td_themes (name, central_idea_prompt, sort_order) VALUES
  ('Who we are',                       'An inquiry into the nature of the self; beliefs and values; personal, physical, mental, social and spiritual health; human relationships.', 1),
  ('Where we are in place and time',   'An inquiry into orientation in place and time; personal histories; homes and journeys; discoveries, explorations and migrations.', 2),
  ('How we express ourselves',         'An inquiry into the ways in which we discover and express ideas, feelings, nature, culture, beliefs and values.', 3),
  ('How the world works',              'An inquiry into the natural world and its laws; the interaction between the natural world and human societies.', 4),
  ('How we organize ourselves',        'An inquiry into the interconnectedness of human-made systems and communities; the structure and function of organizations.', 5),
  ('Sharing the planet',               'An inquiry into rights and responsibilities in the struggle to share finite resources with other people and living things.', 6);

-- 8. Global Contexts (MYP)
CREATE TABLE public.ib_global_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.ib_global_contexts (name, description, sort_order) VALUES
  ('Identities and relationships',      'Students explore identity, beliefs, values, personal, physical, mental, social and spiritual health, human relationships.', 1),
  ('Orientation in space and time',     'Students explore personal histories, homes, journeys, turning points, discoveries, explorations and migration.', 2),
  ('Personal and cultural expression',  'Students explore ways to discover and express ideas, feelings, nature, culture, beliefs and values.', 3),
  ('Scientific and technical innovation','Students explore the natural world and its laws, the interaction between people and the scientific world.', 4),
  ('Globalization and sustainability',  'Students explore the interconnectedness of human-made systems and communities.', 5),
  ('Fairness and development',          'Students explore rights and responsibilities, access to equal opportunities, peace and conflict resolution.', 6);

-- 9. MYP Subject Groups
CREATE TABLE public.ib_myp_subject_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.ib_myp_subject_groups (name, code, sort_order) VALUES
  ('Language and literature',        'LANG_LIT', 1),
  ('Language acquisition',           'LANG_ACQ', 2),
  ('Individuals and societies',      'IND_SOC',  3),
  ('Sciences',                       'SCI',      4),
  ('Mathematics',                    'MATH',     5),
  ('Arts',                           'ARTS',     6),
  ('Physical and health education',  'PHE',      7),
  ('Design',                         'DESIGN',   8);

-- 10. MYP Assessment Criteria (A-D per subject group)
CREATE TABLE public.ib_myp_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_group_id uuid NOT NULL REFERENCES public.ib_myp_subject_groups(id) ON DELETE CASCADE,
  letter char(1) NOT NULL CHECK (letter IN ('A','B','C','D')),
  name text NOT NULL,
  max_level int NOT NULL DEFAULT 8,
  UNIQUE(subject_group_id, letter)
);

-- Language and literature
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_LIT'), 'A', 'Analysing'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_LIT'), 'B', 'Organizing'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_LIT'), 'C', 'Producing text'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_LIT'), 'D', 'Using language');

-- Language acquisition
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_ACQ'), 'A', 'Listening'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_ACQ'), 'B', 'Reading'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_ACQ'), 'C', 'Speaking'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'LANG_ACQ'), 'D', 'Writing');

-- Individuals and societies
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'IND_SOC'), 'A', 'Knowing and understanding'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'IND_SOC'), 'B', 'Investigating'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'IND_SOC'), 'C', 'Communicating'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'IND_SOC'), 'D', 'Thinking critically');

-- Sciences
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'SCI'), 'A', 'Knowing and understanding'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'SCI'), 'B', 'Inquiring and designing'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'SCI'), 'C', 'Processing and evaluating'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'SCI'), 'D', 'Reflecting on the impacts of science');

-- Mathematics
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'MATH'), 'A', 'Knowing and understanding'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'MATH'), 'B', 'Investigating patterns'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'MATH'), 'C', 'Communicating'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'MATH'), 'D', 'Applying mathematics in real-life contexts');

-- Arts
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'ARTS'), 'A', 'Knowing and understanding'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'ARTS'), 'B', 'Developing skills'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'ARTS'), 'C', 'Thinking creatively'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'ARTS'), 'D', 'Responding');

-- Physical and health education
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'PHE'), 'A', 'Knowing and understanding'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'PHE'), 'B', 'Planning for performance'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'PHE'), 'C', 'Applying and performing'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'PHE'), 'D', 'Reflecting and improving performance');

-- Design
INSERT INTO public.ib_myp_criteria (subject_group_id, letter, name) VALUES
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'DESIGN'), 'A', 'Inquiring and analysing'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'DESIGN'), 'B', 'Developing ideas'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'DESIGN'), 'C', 'Creating the solution'),
  ((SELECT id FROM ib_myp_subject_groups WHERE code = 'DESIGN'), 'D', 'Evaluating');

-- 11. Teacher-Class Assignments
CREATE TABLE public.ib_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES auth.users(id),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  subject text,
  subject_group_id uuid REFERENCES public.ib_myp_subject_groups(id),
  is_homeroom boolean NOT NULL DEFAULT false,
  academic_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(teacher_user_id, batch_id, subject, academic_year)
);

-- ===== ROW LEVEL SECURITY =====

ALTER TABLE public.ib_learner_profile_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_atl_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_atl_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_key_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_td_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_global_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_myp_subject_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_myp_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ib_teacher_assignments ENABLE ROW LEVEL SECURITY;

-- Reference tables: readable by all authenticated users
CREATE POLICY "Authenticated read ib_learner_profile_attributes" ON public.ib_learner_profile_attributes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_atl_categories" ON public.ib_atl_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_atl_skills" ON public.ib_atl_skills FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_key_concepts" ON public.ib_key_concepts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_td_themes" ON public.ib_td_themes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_global_contexts" ON public.ib_global_contexts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_myp_subject_groups" ON public.ib_myp_subject_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read ib_myp_criteria" ON public.ib_myp_criteria FOR SELECT TO authenticated USING (true);

-- Reference tables: only admins can write
CREATE POLICY "Admins manage ib_learner_profile_attributes" ON public.ib_learner_profile_attributes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_atl_categories" ON public.ib_atl_categories FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_atl_skills" ON public.ib_atl_skills FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_key_concepts" ON public.ib_key_concepts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_td_themes" ON public.ib_td_themes FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_global_contexts" ON public.ib_global_contexts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_myp_subject_groups" ON public.ib_myp_subject_groups FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins manage ib_myp_criteria" ON public.ib_myp_criteria FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));

-- Teacher assignments: staff can read, admins/coordinators can write
CREATE POLICY "Staff read teacher_assignments" ON public.ib_teacher_assignments
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    teacher_user_id = auth.uid()
  );

CREATE POLICY "Admins manage teacher_assignments" ON public.ib_teacher_assignments
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'ib_coordinator')
  );

-- ===== GRANTS =====
GRANT ALL ON public.ib_learner_profile_attributes TO service_role;
GRANT ALL ON public.ib_atl_categories TO service_role;
GRANT ALL ON public.ib_atl_skills TO service_role;
GRANT ALL ON public.ib_key_concepts TO service_role;
GRANT ALL ON public.ib_td_themes TO service_role;
GRANT ALL ON public.ib_global_contexts TO service_role;
GRANT ALL ON public.ib_myp_subject_groups TO service_role;
GRANT ALL ON public.ib_myp_criteria TO service_role;
GRANT ALL ON public.ib_teacher_assignments TO service_role;

-- Also grant SELECT to anon for public reference data
GRANT SELECT ON public.ib_learner_profile_attributes TO anon;
GRANT SELECT ON public.ib_atl_categories TO anon;
GRANT SELECT ON public.ib_atl_skills TO anon;
GRANT SELECT ON public.ib_key_concepts TO anon;
GRANT SELECT ON public.ib_td_themes TO anon;
GRANT SELECT ON public.ib_global_contexts TO anon;
GRANT SELECT ON public.ib_myp_subject_groups TO anon;
GRANT SELECT ON public.ib_myp_criteria TO anon;
