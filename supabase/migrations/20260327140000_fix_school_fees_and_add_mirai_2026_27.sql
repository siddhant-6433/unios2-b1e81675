-- Fix NIMT Beacon School Avantika (BSAV) fee structures with official 2026-27 NB-* fee codes
-- Add Mirai School (MES) fee structures with official MR-* fee codes
-- BSA (Arthala) fees from migration 130000 are correct and unchanged

DO $$
DECLARE
  v_session_id uuid := 'f0000001-0000-0000-0000-000000000001';

  -- Beacon (NB-*) fee code ids
  v_nb_reg   uuid;
  v_nb_adm   uuid;
  v_nb_cey   uuid;   -- Pre-Nur / Nur / KG composite ₹4,000/month
  v_nb_cpy   uuid;   -- Grade 1–5 composite ₹4,667/month
  v_nb_mey   uuid;   -- Grade 6–8 composite ₹5,000/month
  v_nb_sey   uuid;   -- Grade 9–10 composite ₹6,000/month
  v_nb_ssy   uuid;   -- Grade 11–12 composite ₹7,500/month

  -- Mirai (MR-*) fee code ids
  v_mr_reg   uuid;
  v_mr_adm   uuid;
  v_mr_cey   uuid;   -- EYP (Toddlers–UKG) composite ₹21,600/month
  v_mr_cpy   uuid;   -- PYP (Grade I–V) composite ₹23,800/month

  -- working vars
  v_course_id uuid;
  v_fs_id     uuid;
BEGIN

  -- =========================================================
  -- STEP 1: Upsert official fee codes
  -- =========================================================

  -- Beacon Registration (one-time, ₹500)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-REG', 'Beacon Registration Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_reg;
  IF v_nb_reg IS NULL THEN SELECT id INTO v_nb_reg FROM fee_codes WHERE code = 'NB-REG'; END IF;

  -- Beacon Admission (one-time, ₹20,000)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-ADM', 'Beacon Admission Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_adm;
  IF v_nb_adm IS NULL THEN SELECT id INTO v_nb_adm FROM fee_codes WHERE code = 'NB-ADM'; END IF;

  -- Beacon CEY — Pre-Nursery / Nursery / KG quarterly composite (₹12,000/quarter)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-CEY', 'Beacon Pre-Primary Quarterly Fee (₹4,000/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_cey;
  IF v_nb_cey IS NULL THEN SELECT id INTO v_nb_cey FROM fee_codes WHERE code = 'NB-CEY'; END IF;

  -- Beacon CPY — Grade 1–5 quarterly composite (₹14,001/quarter)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-CPY', 'Beacon Primary Quarterly Fee (₹4,667/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_cpy;
  IF v_nb_cpy IS NULL THEN SELECT id INTO v_nb_cpy FROM fee_codes WHERE code = 'NB-CPY'; END IF;

  -- Beacon MEY — Grade 6–8 quarterly composite (₹15,000/quarter)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-MEY', 'Beacon Middle Quarterly Fee (₹5,000/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_mey;
  IF v_nb_mey IS NULL THEN SELECT id INTO v_nb_mey FROM fee_codes WHERE code = 'NB-MEY'; END IF;

  -- Beacon SEY — Grade 9–10 quarterly composite (₹18,000/quarter)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-SEY', 'Beacon Secondary Quarterly Fee (₹6,000/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_sey;
  IF v_nb_sey IS NULL THEN SELECT id INTO v_nb_sey FROM fee_codes WHERE code = 'NB-SEY'; END IF;

  -- Beacon SSY — Grade 11–12 quarterly composite (₹22,500/quarter)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-SSY', 'Beacon Sr. Secondary Quarterly Fee (₹7,500/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_nb_ssy;
  IF v_nb_ssy IS NULL THEN SELECT id INTO v_nb_ssy FROM fee_codes WHERE code = 'NB-SSY'; END IF;

  -- Mirai Registration (one-time, ₹2,200)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'MR-REG', 'Mirai Registration Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_mr_reg;
  IF v_mr_reg IS NULL THEN SELECT id INTO v_mr_reg FROM fee_codes WHERE code = 'MR-REG'; END IF;

  -- Mirai Admission (one-time, ₹50,000)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'MR-ADM', 'Mirai Admission Fee', 'enrollment', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_mr_adm;
  IF v_mr_adm IS NULL THEN SELECT id INTO v_mr_adm FROM fee_codes WHERE code = 'MR-ADM'; END IF;

  -- Mirai CEY — EYP quarterly composite (₹64,800/quarter = ₹21,600/mo)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'MR-CEY', 'Mirai EYP Quarterly Fee (₹21,600/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_mr_cey;
  IF v_mr_cey IS NULL THEN SELECT id INTO v_mr_cey FROM fee_codes WHERE code = 'MR-CEY'; END IF;

  -- Mirai CPY — PYP quarterly composite (₹71,400/quarter = ₹23,800/mo)
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'MR-CPY', 'Mirai PYP Quarterly Fee (₹23,800/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, is_recurring = EXCLUDED.is_recurring
  RETURNING id INTO v_mr_cpy;
  IF v_mr_cpy IS NULL THEN SELECT id INTO v_mr_cpy FROM fee_codes WHERE code = 'MR-CPY'; END IF;

  -- =========================================================
  -- STEP 2: Replace BSAV fee_structure_items with correct
  --         2026-27 NB-* amounts (quarterly = monthly × 3)
  -- =========================================================

  -- Helper: upsert fee_structure, clear old items, insert new ones
  -- BSAV Toddlers: NB-CEY → ₹12,000/quarter
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-TOD';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q1',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q2',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q3',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q4',           12000, 10);
  END IF;

  -- BSAV Nursery: NB-CEY → ₹12,000/quarter
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-NUR';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q1',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q2',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q3',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q4',           12000, 10);
  END IF;

  -- BSAV LKG: NB-CEY → ₹12,000/quarter
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-LKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q1',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q2',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q3',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q4',           12000, 10);
  END IF;

  -- BSAV UKG: NB-CEY → ₹12,000/quarter
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-UKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q1',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q2',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q3',           12000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cey, 'q4',           12000, 10);
  END IF;

  -- BSAV Grade I–V: NB-CPY → ₹14,001/quarter (₹4,667/mo × 3)
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q1',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q2',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q3',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q4',           14001, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q1',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q2',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q3',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q4',           14001, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q1',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q2',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q3',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q4',           14001, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q1',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q2',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q3',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q4',           14001, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q1',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q2',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q3',           14001, 10),
      (gen_random_uuid(), v_fs_id, v_nb_cpy, 'q4',           14001, 10);
  END IF;

  -- BSAV Grade VI–VIII: NB-MEY → ₹15,000/quarter (₹5,000/mo × 3)
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G6';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q1',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q2',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q3',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q4',           15000, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q1',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q2',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q3',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q4',           15000, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q1',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q2',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q3',           15000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_mey, 'q4',           15000, 10);
  END IF;

  -- BSAV Grade IX–X: NB-SEY → ₹18,000/quarter (₹6,000/mo × 3)
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G9';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q1',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q2',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q3',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q4',           18000, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q1',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q2',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q3',           18000, 10),
      (gen_random_uuid(), v_fs_id, v_nb_sey, 'q4',           18000, 10);
  END IF;

  -- BSAV Grade XI–XII: NB-SSY → ₹22,500/quarter (₹7,500/mo × 3)
  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G11';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q1',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q2',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q3',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q4',           22500, 10);
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
      (gen_random_uuid(), v_fs_id, v_nb_reg, 'registration', 500,   1),
      (gen_random_uuid(), v_fs_id, v_nb_adm, 'admission',    20000, 1),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q1',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q2',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q3',           22500, 10),
      (gen_random_uuid(), v_fs_id, v_nb_ssy, 'q4',           22500, 10);
  END IF;

  -- =========================================================
  -- STEP 3: Insert Mirai School (MES) fee structures
  -- EYP (Toddlers, Montessori, EYP1–3): MR-CEY ₹64,800/quarter
  -- PYP (Grade I–V): MR-CPY ₹71,400/quarter
  -- =========================================================

  -- MES Toddlers: MR-CEY
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-TOD';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q1',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q2',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q3',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q4',           64800, 10);
  END IF;

  -- MES Montessori: MR-CEY
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-MON';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q1',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q2',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q3',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q4',           64800, 10);
  END IF;

  -- MES EYP 1 (Junior/Nursery): MR-CEY
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-EYP1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q1',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q2',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q3',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q4',           64800, 10);
  END IF;

  -- MES EYP 2 (Senior/LKG): MR-CEY
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-EYP2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q1',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q2',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q3',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q4',           64800, 10);
  END IF;

  -- MES EYP 3 (Graduation/UKG): MR-CEY
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-EYP3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q1',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q2',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q3',           64800, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cey, 'q4',           64800, 10);
  END IF;

  -- MES PYP 1–5 (Grade I–V): MR-CPY → ₹71,400/quarter (₹23,800/mo × 3)
  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-PYP1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q1',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q2',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q3',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q4',           71400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-PYP2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q1',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q2',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q3',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q4',           71400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-PYP3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q1',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q2',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q3',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q4',           71400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-PYP4';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q1',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q2',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q3',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q4',           71400, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'MES-PYP5';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'standard', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='standard'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_mr_reg, 'registration', 2200,  1),
      (gen_random_uuid(), v_fs_id, v_mr_adm, 'admission',    50000, 1),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q1',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q2',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q3',           71400, 10),
      (gen_random_uuid(), v_fs_id, v_mr_cpy, 'q4',           71400, 10);
  END IF;

END $$;
