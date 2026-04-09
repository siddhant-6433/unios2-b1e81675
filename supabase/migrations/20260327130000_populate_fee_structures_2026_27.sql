-- Fee Structures 2026-27: NIMT Colleges + Beacon Avantika + Arthala

DO $$
DECLARE
  v_session_id uuid := 'f0000001-0000-0000-0000-000000000001';

  -- fee code ids
  v_fc_form_fee        uuid;
  v_fc_tuition_y1      uuid;
  v_fc_tuition_y2      uuid;
  v_fc_tuition_y3      uuid;
  v_fc_tuition_y4      uuid;
  v_fc_tuition_y5      uuid;
  v_fc_sch_admission   uuid;
  v_fc_sch_q1          uuid;
  v_fc_sch_q2          uuid;
  v_fc_sch_q3          uuid;
  v_fc_sch_q4          uuid;

  -- working vars
  v_course_id          uuid;
  v_fs_id              uuid;
BEGIN

  -- =========================================================
  -- STEP 1: Upsert fee codes
  -- =========================================================

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'FORM-FEE', 'Application / Form Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_form_fee;
  IF v_fc_form_fee IS NULL THEN SELECT id INTO v_fc_form_fee FROM fee_codes WHERE code = 'FORM-FEE'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'TUITION-Y1', 'Year 1 Tuition Fee', 'tuition', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition_y1;
  IF v_fc_tuition_y1 IS NULL THEN SELECT id INTO v_fc_tuition_y1 FROM fee_codes WHERE code = 'TUITION-Y1'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'TUITION-Y2', 'Year 2 Tuition Fee', 'tuition', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition_y2;
  IF v_fc_tuition_y2 IS NULL THEN SELECT id INTO v_fc_tuition_y2 FROM fee_codes WHERE code = 'TUITION-Y2'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'TUITION-Y3', 'Year 3 Tuition Fee', 'tuition', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition_y3;
  IF v_fc_tuition_y3 IS NULL THEN SELECT id INTO v_fc_tuition_y3 FROM fee_codes WHERE code = 'TUITION-Y3'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'TUITION-Y4', 'Year 4 Tuition Fee', 'tuition', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition_y4;
  IF v_fc_tuition_y4 IS NULL THEN SELECT id INTO v_fc_tuition_y4 FROM fee_codes WHERE code = 'TUITION-Y4'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'TUITION-Y5', 'Year 5 Tuition Fee', 'tuition', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_tuition_y5;
  IF v_fc_tuition_y5 IS NULL THEN SELECT id INTO v_fc_tuition_y5 FROM fee_codes WHERE code = 'TUITION-Y5'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'SCH-ADMISSION', 'School Admission Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_sch_admission;
  IF v_fc_sch_admission IS NULL THEN SELECT id INTO v_fc_sch_admission FROM fee_codes WHERE code = 'SCH-ADMISSION'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'SCH-Q1', 'School Tuition Q1 (Apr–Jun)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_sch_q1;
  IF v_fc_sch_q1 IS NULL THEN SELECT id INTO v_fc_sch_q1 FROM fee_codes WHERE code = 'SCH-Q1'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'SCH-Q2', 'School Tuition Q2 (Jul–Sep)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_sch_q2;
  IF v_fc_sch_q2 IS NULL THEN SELECT id INTO v_fc_sch_q2 FROM fee_codes WHERE code = 'SCH-Q2'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'SCH-Q3', 'School Tuition Q3 (Oct–Dec)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_sch_q3;
  IF v_fc_sch_q3 IS NULL THEN SELECT id INTO v_fc_sch_q3 FROM fee_codes WHERE code = 'SCH-Q3'; END IF;

  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'SCH-Q4', 'School Tuition Q4 (Jan–Mar)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_fc_sch_q4;
  IF v_fc_sch_q4 IS NULL THEN SELECT id INTO v_fc_sch_q4 FROM fee_codes WHERE code = 'SCH-Q4'; END IF;

  -- =========================================================
  -- STEP 2: Helper macro (inlined) — for each college course:
  --   a) look up course id
  --   b) upsert fee_structure → get id
  --   c) delete old items
  --   d) insert new items (skip NULL years, skip form_fee=0)
  -- =========================================================

  -- -------------------------------------------------------
  -- NIMT COLLEGE COURSES
  -- -------------------------------------------------------

  -- BSCN-GN  | form=1000 | Y1=153000 | Y2=157590 | Y3=162318 | Y4=167187
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSCN-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       153000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       157590, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       162318, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y4, 'year_4',       167187, 10);
  END IF;

  -- GNM-GN  | form=1000 | Y1=118000 | Y2=121540 | Y3=125186
  SELECT id INTO v_course_id FROM courses WHERE code = 'GNM-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       118000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       121540, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       125186, 10);
  END IF;

  -- BMRIT-GN  | form=1000 | Y1=92000 | Y2=94760 | Y3=97603
  SELECT id INTO v_course_id FROM courses WHERE code = 'BMRIT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       92000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       94760, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       97603, 10);
  END IF;

  -- MMRIT-GN  | form=1000 | Y1=89000 | Y2=91670
  SELECT id INTO v_course_id FROM courses WHERE code = 'MMRIT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       89000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       91670, 10);
  END IF;

  -- DPT-GN  | form=1000 | Y1=62000 | Y2=63860
  SELECT id INTO v_course_id FROM courses WHERE code = 'DPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       62000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       63860, 10);
  END IF;

  -- BPT-GN  | form=1000 | Y1=92000 | Y2=94760 | Y3=97603 | Y4=100531
  SELECT id INTO v_course_id FROM courses WHERE code = 'BPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       92000,  10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       94760,  10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       97603,  10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y4, 'year_4',       100531, 10);
  END IF;

  -- MPT-GN  | form=1000 | Y1=89000 | Y2=91670
  SELECT id INTO v_course_id FROM courses WHERE code = 'MPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       89000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       91670, 10);
  END IF;

  -- OTT-GN  | form=1000 | Y1=62000 | Y2=63860
  SELECT id INTO v_course_id FROM courses WHERE code = 'OTT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       62000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       63860, 10);
  END IF;

  -- DPHARMA-GN  | form=1000 | Y1=95000 | Y2=97850
  SELECT id INTO v_course_id FROM courses WHERE code = 'DPHARMA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       95000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       97850, 10);
  END IF;

  -- BCA-GN  | form=1000 | Y1=75000 | Y2=77250 | Y3=79568
  SELECT id INTO v_course_id FROM courses WHERE code = 'BCA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       75000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       77250, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       79568, 10);
  END IF;

  -- BBA-GN  | form=1000 | Y1=75000 | Y2=77250 | Y3=79568
  SELECT id INTO v_course_id FROM courses WHERE code = 'BBA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       75000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       77250, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       79568, 10);
  END IF;

  -- MBA-GN  | form=1500 | Y1=130000 | Y2=133900
  SELECT id INTO v_course_id FROM courses WHERE code = 'MBA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1500,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       130000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       133900, 10);
  END IF;

  -- PGDM-GN  | form=1500 | Y1=225000 | Y2=231750
  SELECT id INTO v_course_id FROM courses WHERE code = 'PGDM-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1500,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       225000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       231750, 10);
  END IF;

  -- PGDM-GZ  | form=1500 | Y1=225000 | Y2=231750
  SELECT id INTO v_course_id FROM courses WHERE code = 'PGDM-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1500,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       225000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       231750, 10);
  END IF;

  -- PGDM-KT  | form=1000 | Y1=225000 | Y2=231750
  SELECT id INTO v_course_id FROM courses WHERE code = 'PGDM-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       225000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       231750, 10);
  END IF;

  -- BALLB-GN  | form=1000 | Y1=110000 | Y2=113300 | Y3=116699 | Y4=120200 | Y5=123806
  SELECT id INTO v_course_id FROM courses WHERE code = 'BALLB-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,   1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       110000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       113300, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       116699, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y4, 'year_4',       120200, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y5, 'year_5',       123806, 10);
  END IF;

  -- LLB-GN  | form=1000 | Y1=44250 | Y2=45578 | Y3=46945
  SELECT id INTO v_course_id FROM courses WHERE code = 'LLB-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       44250, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       45578, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       46945, 10);
  END IF;

  -- LLB-KT  | form=1000 | Y1=44250 | Y2=45578 | Y3=46945
  SELECT id INTO v_course_id FROM courses WHERE code = 'LLB-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_form_fee,   'registration', 1000,  1),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1',       44250, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2',       45578, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y3, 'year_3',       46945, 10);
  END IF;

  -- BED-GN  | form=0 (skip) | Y1=56000 | Y2=32000
  SELECT id INTO v_course_id FROM courses WHERE code = 'BED-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1', 56000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2', 32000, 10);
  END IF;

  -- BED-GZ  | form=0 (skip) | Y1=56000 | Y2=32000
  SELECT id INTO v_course_id FROM courses WHERE code = 'BED-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1', 56000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2', 32000, 10);
  END IF;

  -- BED-KT  | form=0 (skip) | Y1=27000 | Y2=27000
  SELECT id INTO v_course_id FROM courses WHERE code = 'BED-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1', 27000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2', 27000, 10);
  END IF;

  -- DELED-GZ  | form=0 (skip) | Y1=45000 | Y2=45000
  SELECT id INTO v_course_id FROM courses WHERE code = 'DELED-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y1, 'year_1', 45000, 10),
      (gen_random_uuid(), v_fs_id, v_fc_tuition_y2, 'year_2', 45000, 10);
  END IF;

  -- -------------------------------------------------------
  -- PART 2: NIMT Beacon School Avantika (BSAV)
  -- Admission fee (one-time): 20000 for ALL grades
  -- Quarterly tuition: 4 equal quarters
  -- -------------------------------------------------------

  -- Nursery & KG: BSAV-TOD, BSAV-NUR, BSAV-LKG, BSAV-UKG  | admission=20000 | quarterly=6930

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-TOD';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        6930,  10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-NUR';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        6930,  10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-LKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        6930,  10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-UKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        6930,  10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        6930,  10);
  END IF;

  -- Class I–V: BSAV-G1..G5  | admission=20000 | quarterly=10395

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        10395, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        10395, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        10395, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G4';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        10395, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G5';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        10395, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        10395, 10);
  END IF;

  -- Class VI–VIII: BSAV-G6..G8  | admission=20000 | quarterly=13860

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G6';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        13860, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G7';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        13860, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G8';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        13860, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        13860, 10);
  END IF;

  -- Class IX–X: BSAV-G9..G10  | admission=20000 | quarterly=16170

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G9';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        16170, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G10';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        16170, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        16170, 10);
  END IF;

  -- Class XI–XII: BSAV-G11..G12  | admission=20000 | quarterly=23100

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G11';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        23100, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G12';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 20000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        23100, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        23100, 10);
  END IF;

  -- -------------------------------------------------------
  -- PART 3: NIMT School Arthala (BSA)
  -- Grades up to Grade VIII only
  -- Per-group admission fees differ from Avantika
  -- -------------------------------------------------------

  -- Nursery/KG/Class 1: BSA-TOD, BSA-NUR, BSA-LKG, BSA-UKG, BSA-G1
  --   admission=2200 | quarterly=2400

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-TOD';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2200, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-NUR';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2200, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-LKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2200, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-UKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2200, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2200, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2400, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2400, 10);
  END IF;

  -- Class 2–5: BSA-G2..G5  | admission=2500 | quarterly=2850

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2500, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2850, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2500, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2850, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G4';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2500, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2850, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G5';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 2500, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        2850, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        2850, 10);
  END IF;

  -- Class 6–8: BSA-G6..G8  | admission=3000 | quarterly=3450

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G6';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 3000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        3450, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G7';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 3000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        3450, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSA-G8';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_fc_sch_admission, 'admission', 3000, 1),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q1,        'q1',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q2,        'q2',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q3,        'q3',        3450, 10),
      (gen_random_uuid(), v_fs_id, v_fc_sch_q4,        'q4',        3450, 10);
  END IF;

END $$;
