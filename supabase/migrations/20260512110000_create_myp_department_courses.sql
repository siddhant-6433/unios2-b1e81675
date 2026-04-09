-- Create MYP department and courses under Mirai (GZ1-MES)
-- This was skipped in 20260410100000 because the institution lookup used wrong code

DO $$
DECLARE
  v_inst_id uuid;
  v_myp_dept_id uuid;
  v_course_id uuid;
BEGIN
  SELECT id INTO v_inst_id FROM public.institutions WHERE code = 'GZ1-MES';

  IF v_inst_id IS NULL THEN
    RAISE NOTICE 'GZ1-MES institution not found, skipping';
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

  INSERT INTO public.courses (department_id, name, code, duration_years, type) VALUES
    (v_myp_dept_id, 'MYP 1 (Grade VI)',   'MES-MYP1', 1, 'annual'),
    (v_myp_dept_id, 'MYP 2 (Grade VII)',  'MES-MYP2', 1, 'annual'),
    (v_myp_dept_id, 'MYP 3 (Grade VIII)', 'MES-MYP3', 1, 'annual')
  ON CONFLICT (code) DO NOTHING;

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
