DO $$
DECLARE
  v_campus_id uuid;
  v_institution_id uuid;
  v_eyp_dept_id uuid;
  v_pyp_dept_id uuid;

  v_course_toddlers uuid;
  v_course_montessori uuid;
  v_course_eyp1 uuid;
  v_course_eyp2 uuid;
  v_course_eyp3 uuid;
  v_course_pyp1 uuid;
  v_course_pyp2 uuid;
  v_course_pyp3 uuid;
  v_course_pyp4 uuid;
  v_course_pyp5 uuid;
BEGIN
  INSERT INTO public.campuses (name, code, city, state)
  VALUES ('Mirai Experiential School Branch', 'MIRAI-EXP', 'Ghaziabad', 'Uttar Pradesh')
  ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      city = EXCLUDED.city,
      state = EXCLUDED.state
  RETURNING id INTO v_campus_id;

  INSERT INTO public.institutions (campus_id, name, code, type)
  VALUES (v_campus_id, 'Mirai Experiential School', 'MES', 'school')
  ON CONFLICT (code) DO UPDATE
  SET campus_id = EXCLUDED.campus_id,
      name = EXCLUDED.name,
      type = EXCLUDED.type
  RETURNING id INTO v_institution_id;

  INSERT INTO public.departments (institution_id, name, code)
  VALUES (v_institution_id, 'Early Years Programme', 'EYP')
  RETURNING id INTO v_eyp_dept_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_eyp_dept_id FROM public.departments WHERE institution_id = v_institution_id AND code = 'EYP' LIMIT 1;
END $$;

DO $$
DECLARE
  v_institution_id uuid;
  v_pyp_dept_id uuid;
BEGIN
  SELECT id INTO v_institution_id FROM public.institutions WHERE code = 'MES' LIMIT 1;

  INSERT INTO public.departments (institution_id, name, code)
  VALUES (v_institution_id, 'Primary Years Programme', 'PYP')
  RETURNING id INTO v_pyp_dept_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_pyp_dept_id FROM public.departments WHERE institution_id = v_institution_id AND code = 'PYP' LIMIT 1;
END $$;

DO $$
DECLARE
  v_eyp_dept_id uuid;
  v_pyp_dept_id uuid;
  v_course_id uuid;
BEGIN
  SELECT id INTO v_eyp_dept_id FROM public.departments WHERE code = 'EYP' AND institution_id = (SELECT id FROM public.institutions WHERE code = 'MES' LIMIT 1) LIMIT 1;
  SELECT id INTO v_pyp_dept_id FROM public.departments WHERE code = 'PYP' AND institution_id = (SELECT id FROM public.institutions WHERE code = 'MES' LIMIT 1) LIMIT 1;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_eyp_dept_id, 'Toddlers', 'MES-TOD', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 2, 'Minimum age: 1.6 years')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_eyp_dept_id, 'Montessori', 'MES-MON', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 2, 'Minimum age: 2 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_eyp_dept_id, 'EYP 1 (Junior/Nursery)', 'MES-EYP1', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 3, 'Minimum age: 3 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_eyp_dept_id, 'EYP 2 (Senior/LKG)', 'MES-EYP2', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 4, 'Minimum age: 4 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_eyp_dept_id, 'EYP 3 (Graduation/UKG)', 'MES-EYP3', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 5, 'Minimum age: 5 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_pyp_dept_id, 'PYP 1 (Grade I)', 'MES-PYP1', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 6, 'Minimum age: 6 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_pyp_dept_id, 'PYP 2 (Grade II)', 'MES-PYP2', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 7, 'Minimum age: 7 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_pyp_dept_id, 'PYP 3 (Grade III)', 'MES-PYP3', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 8, 'Minimum age: 8 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_pyp_dept_id, 'PYP 4 (Grade IV)', 'MES-PYP4', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 9, 'Minimum age: 9 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;

  INSERT INTO public.courses (department_id, name, code, duration_years, type)
  VALUES (v_pyp_dept_id, 'PYP 5 (Grade V)', 'MES-PYP5', 1, 'annual')
  ON CONFLICT (code) DO UPDATE SET department_id = EXCLUDED.department_id, name = EXCLUDED.name
  RETURNING id INTO v_course_id;
  INSERT INTO public.eligibility_rules (course_id, min_age, notes)
  VALUES (v_course_id, 10, 'Minimum age: 10 years plus')
  ON CONFLICT (course_id) DO UPDATE SET min_age = EXCLUDED.min_age, notes = EXCLUDED.notes;
END $$;
