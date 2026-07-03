-- Update NIMT School Arthala (BSA) fee structures.
-- Applies the same monthly tuition rates for new and existing parents.
-- No admission fee is charged.

DO $$
DECLARE
  v_session_id uuid;
  v_department_id uuid;
  v_course record;
  v_fs_id uuid;
  v_fee_code_id uuid;
  v_version text;
BEGIN
  SELECT id INTO v_session_id
  FROM public.admission_sessions
  WHERE id = 'f0000001-0000-0000-0000-000000000001';

  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id
    FROM public.admission_sessions
    WHERE is_active = true
    ORDER BY start_date DESC
    LIMIT 1;
  END IF;

  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id
    FROM public.admission_sessions
    ORDER BY start_date DESC
    LIMIT 1;
  END IF;

  SELECT c.department_id INTO v_department_id
  FROM public.courses c
  WHERE c.code = 'BSA-G8'
  LIMIT 1;

  IF v_department_id IS NULL THEN
    SELECT c.department_id INTO v_department_id
    FROM public.courses c
    WHERE c.code LIKE 'BSA-%'
    ORDER BY c.code
    LIMIT 1;
  END IF;

  IF v_department_id IS NULL THEN
    SELECT d.id INTO v_department_id
    FROM public.departments d
    JOIN public.institutions i ON i.id = d.institution_id
    WHERE i.code = 'GZ1-BSA'
    ORDER BY d.name
    LIMIT 1;
  END IF;

  -- Arthala now includes Grade IX and Grade X fee rows.
  IF v_department_id IS NOT NULL THEN
    INSERT INTO public.courses (department_id, name, code, duration_years, type)
    VALUES
      (v_department_id, 'Grade IX', 'BSA-G9', 1, 'quarterly'),
      (v_department_id, 'Grade X', 'BSA-G10', 1, 'quarterly')
    ON CONFLICT (code) DO UPDATE SET
      department_id = EXCLUDED.department_id,
      name = EXCLUDED.name,
      duration_years = EXCLUDED.duration_years,
      type = EXCLUDED.type;
  END IF;

  INSERT INTO public.fee_codes (code, name, category, is_recurring)
  VALUES
    ('BSA-CEY', 'NIMT School Arthala Nursery-Class I Tuition (Rs 800/mo)', 'tuition', true),
    ('BSA-CPY', 'NIMT School Arthala Class II-V Tuition (Rs 950/mo)', 'tuition', true),
    ('BSA-MEY', 'NIMT School Arthala Class VI-VIII Tuition (Rs 1,150/mo)', 'tuition', true),
    ('BSA-SEY', 'NIMT School Arthala Class IX-X Tuition (Rs 1,450/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_recurring = EXCLUDED.is_recurring;

  FOR v_course IN
    SELECT *
    FROM (
      VALUES
        ('BSA-TOD',  'BSA-CEY',  800),
        ('BSA-NUR',  'BSA-CEY',  800),
        ('BSA-LKG',  'BSA-CEY',  800),
        ('BSA-UKG',  'BSA-CEY',  800),
        ('BSA-G1',   'BSA-CEY',  800),
        ('BSA-G2',   'BSA-CPY',  950),
        ('BSA-G3',   'BSA-CPY',  950),
        ('BSA-G4',   'BSA-CPY',  950),
        ('BSA-G5',   'BSA-CPY',  950),
        ('BSA-G6',   'BSA-MEY', 1150),
        ('BSA-G7',   'BSA-MEY', 1150),
        ('BSA-G8',   'BSA-MEY', 1150),
        ('BSA-G9',   'BSA-SEY', 1450),
        ('BSA-G10',  'BSA-SEY', 1450)
    ) AS rates(course_code, fee_code, monthly_amount)
    JOIN public.courses c ON c.code = rates.course_code
  LOOP
    SELECT id INTO v_fee_code_id
    FROM public.fee_codes
    WHERE code = v_course.fee_code;

    FOREACH v_version IN ARRAY ARRAY['standard', 'new_admission', 'existing_parent']
    LOOP
      INSERT INTO public.fee_structures (course_id, session_id, version, is_active)
      VALUES (v_course.id, v_session_id, v_version, true)
      ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
      RETURNING id INTO v_fs_id;

      DELETE FROM public.fee_structure_items
      WHERE fee_structure_id = v_fs_id;

      INSERT INTO public.fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
      VALUES
        (v_fs_id, v_fee_code_id, 'q1', v_course.monthly_amount * 3, 10),
        (v_fs_id, v_fee_code_id, 'q2', v_course.monthly_amount * 3, 10),
        (v_fs_id, v_fee_code_id, 'q3', v_course.monthly_amount * 3, 10),
        (v_fs_id, v_fee_code_id, 'q4', v_course.monthly_amount * 3, 10);
    END LOOP;
  END LOOP;
END $$;
