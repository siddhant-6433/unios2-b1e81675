-- BSAV Two-tier fee structure: new_admission vs existing_parent
-- ─────────────────────────────────────────────────────────────────
-- 1. Rename existing BSAV fee_structures version 'standard' → 'new_admission'
-- 2. Add 'existing_parent' fee structures with 2026-27 CPI-revised rates
-- 3. Add applicant_type column to applications table

-- ── Step 1: Rename version for all BSAV courses ───────────────────
UPDATE public.fee_structures
SET version = 'new_admission'
WHERE version = 'standard'
  AND course_id IN (SELECT id FROM public.courses WHERE code LIKE 'BSAV-%');

-- ── Step 2: Add applicant_type to applications ────────────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS applicant_type text DEFAULT 'new'
    CHECK (applicant_type IN ('new', 'existing'));

-- ── Step 3: Insert existing_parent fee structures ─────────────────
DO $$
DECLARE
  v_session_id uuid := 'f0000001-0000-0000-0000-000000000001';
  v_nb_cey     uuid;
  v_nb_cpy     uuid;
  v_nb_mey     uuid;
  v_nb_sey     uuid;
  v_nb_ssy     uuid;
  v_course_id  uuid;
  v_fs_id      uuid;

  -- Existing parent fee code IDs (EP suffix = Existing Parent rates)
  v_ep_cey     uuid;
  v_ep_cpy     uuid;
  v_ep_mey     uuid;
  v_ep_sey     uuid;
  v_ep_ssy     uuid;
BEGIN

  -- Upsert existing-parent fee codes with official CPI-revised 2026-27 rates
  -- Pre-Nur / Nur / KG: ₹2,485/mo → ₹7,455/quarter
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-CEY-EP', 'Beacon Pre-Primary Quarterly Fee – Existing Parent (₹2,485/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ep_cey;
  IF v_ep_cey IS NULL THEN SELECT id INTO v_ep_cey FROM fee_codes WHERE code = 'NB-CEY-EP'; END IF;

  -- Grade I–V: ₹3,727/mo → ₹11,181/quarter
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-CPY-EP', 'Beacon Primary Quarterly Fee – Existing Parent (₹3,727/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ep_cpy;
  IF v_ep_cpy IS NULL THEN SELECT id INTO v_ep_cpy FROM fee_codes WHERE code = 'NB-CPY-EP'; END IF;

  -- Grade VI–VIII: ₹4,969/mo → ₹14,907/quarter
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-MEY-EP', 'Beacon Middle Quarterly Fee – Existing Parent (₹4,969/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ep_mey;
  IF v_ep_mey IS NULL THEN SELECT id INTO v_ep_mey FROM fee_codes WHERE code = 'NB-MEY-EP'; END IF;

  -- Grade IX–X: ₹5,797/mo → ₹17,391/quarter
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-SEY-EP', 'Beacon Secondary Quarterly Fee – Existing Parent (₹5,797/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ep_sey;
  IF v_ep_sey IS NULL THEN SELECT id INTO v_ep_sey FROM fee_codes WHERE code = 'NB-SEY-EP'; END IF;

  -- Grade XI–XII: ₹8,282/mo → ₹24,846/quarter
  INSERT INTO fee_codes (id, code, name, category, is_recurring)
  VALUES (gen_random_uuid(), 'NB-SSY-EP', 'Beacon Sr. Secondary Quarterly Fee – Existing Parent (₹8,282/mo)', 'tuition', true)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_ep_ssy;
  IF v_ep_ssy IS NULL THEN SELECT id INTO v_ep_ssy FROM fee_codes WHERE code = 'NB-SSY-EP'; END IF;

  -- ── Helper: for each BSAV course insert existing_parent fee structure ──
  -- Toddlers / Nursery / LKG / UKG → CEY-EP  ₹7,455/quarter

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-TOD';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q1', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q2', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q3', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q4', 7455, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-NUR';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q1', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q2', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q3', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q4', 7455, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-LKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q1', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q2', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q3', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q4', 7455, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-UKG';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q1', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q2', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q3', 7455, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cey, 'q4', 7455, 10);
  END IF;

  -- Grade I–V → CPY-EP  ₹11,181/quarter

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G1';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q1', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q2', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q3', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q4', 11181, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G2';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q1', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q2', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q3', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q4', 11181, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G3';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q1', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q2', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q3', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q4', 11181, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G4';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q1', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q2', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q3', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q4', 11181, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G5';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q1', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q2', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q3', 11181, 10),
      (gen_random_uuid(), v_fs_id, v_ep_cpy, 'q4', 11181, 10);
  END IF;

  -- Grade VI–VIII → MEY-EP  ₹14,907/quarter

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G6';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q1', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q2', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q3', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q4', 14907, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G7';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q1', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q2', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q3', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q4', 14907, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G8';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q1', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q2', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q3', 14907, 10),
      (gen_random_uuid(), v_fs_id, v_ep_mey, 'q4', 14907, 10);
  END IF;

  -- Grade IX–X → SEY-EP  ₹17,391/quarter

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G9';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q1', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q2', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q3', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q4', 17391, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G10';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q1', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q2', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q3', 17391, 10),
      (gen_random_uuid(), v_fs_id, v_ep_sey, 'q4', 17391, 10);
  END IF;

  -- Grade XI–XII → SSY-EP  ₹24,846/quarter

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G11';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q1', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q2', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q3', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q4', 24846, 10);
  END IF;

  SELECT id INTO v_course_id FROM courses WHERE code = 'BSAV-G12';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO fee_structures (id, course_id, session_id, version, is_active)
    VALUES (gen_random_uuid(), v_course_id, v_session_id, 'existing_parent', true)
    ON CONFLICT (course_id, session_id, version) DO UPDATE SET is_active = true
    RETURNING id INTO v_fs_id;
    IF v_fs_id IS NULL THEN SELECT id INTO v_fs_id FROM fee_structures WHERE course_id=v_course_id AND session_id=v_session_id AND version='existing_parent'; END IF;
    DELETE FROM fee_structure_items WHERE fee_structure_id = v_fs_id;
    INSERT INTO fee_structure_items (id, fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q1', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q2', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q3', 24846, 10),
      (gen_random_uuid(), v_fs_id, v_ep_ssy, 'q4', 24846, 10);
  END IF;

END $$;
