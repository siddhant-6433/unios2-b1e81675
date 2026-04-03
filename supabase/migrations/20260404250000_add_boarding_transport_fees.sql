-- Add boarding, transport, and security deposit fee codes and items
-- for Beacon School Avantika and Mirai School

-- =====================================================
-- 1. BEACON SCHOOL FEE CODES
-- =====================================================

-- Security Deposit (boarders only)
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('NB-SEC', 'Beacon Security Deposit (Boarders Only)', 'enrollment', false)
ON CONFLICT (code) DO NOTHING;

-- Transport fees
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('NB-TR1', 'Beacon Transport (Within 5 Kms)', 'transport', true),
  ('NB-TR2', 'Beacon Transport (5-10 Kms)', 'transport', true),
  ('NB-TR3', 'Beacon Transport (Over 10 Kms)', 'transport', true)
ON CONFLICT (code) DO NOTHING;

-- Boarding fees
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('NB-NAC', 'Beacon Boarding Non-AC (₹16,728/mo)', 'hostel', true),
  ('NB-CBA', 'Beacon Boarding AC-CB (₹18,728/mo)', 'hostel', true),
  ('NB-IBA', 'Beacon Boarding AC-IB (₹26,000/mo)', 'hostel', true)
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- 2. MIRAI SCHOOL FEE CODES
-- =====================================================

INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('MR-REG', 'Mirai Registration Fee', 'enrollment', false),
  ('MR-ADM', 'Mirai Admission Fee', 'enrollment', false),
  ('MR-SEC', 'Mirai Security Deposit (Boarders Only)', 'enrollment', false),
  ('MR-CEY', 'Mirai IB EYP Composite Fee (₹21,600/mo)', 'tuition', true),
  ('MR-CPY', 'Mirai IB PYP Composite Fee (₹23,800/mo)', 'tuition', true),
  ('MR-MEY', 'Mirai Meal Charges - Breakfast (₹2,200/mo)', 'other', true),
  ('MR-MPY', 'Mirai Meal Charges - Breakfast & Lunch (₹4,400/mo)', 'other', true),
  ('MR-TR1', 'Mirai Transport (Within 10 Kms)', 'transport', true),
  ('MR-TR2', 'Mirai Transport (Beyond 10 Kms - Ghaziabad/GN West)', 'transport', true),
  ('MR-TR3', 'Mirai Transport (Delhi NCR)', 'transport', true),
  ('MR-B7', 'Mirai 7-Day Boarding AC-IB (₹26,000/mo)', 'hostel', true),
  ('MR-B5', 'Mirai 5-Day Boarding AC-IB (₹23,000/mo)', 'hostel', true)
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- 3. ADD BEACON BOARDING + TRANSPORT + SECURITY TO ALL BEACON AVANTIKA COURSES
-- =====================================================

-- Helper: get fee_code IDs
DO $$
DECLARE
  v_fc_sec uuid;
  v_fc_tr1 uuid;
  v_fc_tr2 uuid;
  v_fc_tr3 uuid;
  v_fc_nac uuid;
  v_fc_cba uuid;
  v_fc_iba uuid;
  v_fs record;
BEGIN
  SELECT id INTO v_fc_sec FROM fee_codes WHERE code = 'NB-SEC';
  SELECT id INTO v_fc_tr1 FROM fee_codes WHERE code = 'NB-TR1';
  SELECT id INTO v_fc_tr2 FROM fee_codes WHERE code = 'NB-TR2';
  SELECT id INTO v_fc_tr3 FROM fee_codes WHERE code = 'NB-TR3';
  SELECT id INTO v_fc_nac FROM fee_codes WHERE code = 'NB-NAC';
  SELECT id INTO v_fc_cba FROM fee_codes WHERE code = 'NB-CBA';
  SELECT id INTO v_fc_iba FROM fee_codes WHERE code = 'NB-IBA';

  -- For each active Beacon Avantika new_admission fee structure
  FOR v_fs IN
    SELECT fs.id
    FROM fee_structures fs
    JOIN courses c ON c.id = fs.course_id
    WHERE c.code LIKE 'BSAV-%' AND fs.is_active = true AND fs.version = 'new_admission'
  LOOP
    -- Security deposit
    INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
    VALUES (v_fs.id, v_fc_sec, 'admission', 20000, 1)
    ON CONFLICT DO NOTHING;

    -- Transport (quarterly)
    FOR q IN 1..4 LOOP
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
      VALUES
        (v_fs.id, v_fc_tr1, 'q' || q, 1800 * 3, 10),
        (v_fs.id, v_fc_tr2, 'q' || q, 2500 * 3, 10),
        (v_fs.id, v_fc_tr3, 'q' || q, 3500 * 3, 10)
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Boarding (quarterly = monthly * 3)
    FOR q IN 1..4 LOOP
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
      VALUES
        (v_fs.id, v_fc_nac, 'q' || q, 16728 * 3, 10),
        (v_fs.id, v_fc_cba, 'q' || q, 18728 * 3, 10),
        (v_fs.id, v_fc_iba, 'q' || q, 26000 * 3, 10)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Also for existing_parent Beacon Avantika structures (same boarding rates)
  FOR v_fs IN
    SELECT fs.id
    FROM fee_structures fs
    JOIN courses c ON c.id = fs.course_id
    WHERE c.code LIKE 'BSAV-%' AND fs.is_active = true AND fs.version = 'existing_parent'
  LOOP
    INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
    VALUES (v_fs.id, v_fc_sec, 'admission', 20000, 1)
    ON CONFLICT DO NOTHING;

    FOR q IN 1..4 LOOP
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day)
      VALUES
        (v_fs.id, v_fc_tr1, 'q' || q, 1800 * 3, 10),
        (v_fs.id, v_fc_tr2, 'q' || q, 2500 * 3, 10),
        (v_fs.id, v_fc_tr3, 'q' || q, 3500 * 3, 10),
        (v_fs.id, v_fc_nac, 'q' || q, 16728 * 3, 10),
        (v_fs.id, v_fc_cba, 'q' || q, 18728 * 3, 10),
        (v_fs.id, v_fc_iba, 'q' || q, 26000 * 3, 10)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- =====================================================
-- 4. CREATE MIRAI FEE STRUCTURES
-- =====================================================

DO $$
DECLARE
  v_session_id uuid;
  v_fs_id uuid;
  v_course record;
  -- Fee code IDs
  v_mr_reg uuid;
  v_mr_adm uuid;
  v_mr_sec uuid;
  v_mr_cey uuid;
  v_mr_cpy uuid;
  v_mr_mey uuid;
  v_mr_mpy uuid;
  v_mr_tr1 uuid;
  v_mr_tr2 uuid;
  v_mr_tr3 uuid;
  v_mr_b7 uuid;
  v_mr_b5 uuid;
  v_tuition_code uuid;
  v_tuition_amount numeric;
  v_meal_code uuid;
  v_meal_amount numeric;
BEGIN
  -- Get session
  SELECT id INTO v_session_id FROM admission_sessions WHERE name LIKE '%2026%' LIMIT 1;
  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id FROM admission_sessions ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- Get fee code IDs
  SELECT id INTO v_mr_reg FROM fee_codes WHERE code = 'MR-REG';
  SELECT id INTO v_mr_adm FROM fee_codes WHERE code = 'MR-ADM';
  SELECT id INTO v_mr_sec FROM fee_codes WHERE code = 'MR-SEC';
  SELECT id INTO v_mr_cey FROM fee_codes WHERE code = 'MR-CEY';
  SELECT id INTO v_mr_cpy FROM fee_codes WHERE code = 'MR-CPY';
  SELECT id INTO v_mr_mey FROM fee_codes WHERE code = 'MR-MEY';
  SELECT id INTO v_mr_mpy FROM fee_codes WHERE code = 'MR-MPY';
  SELECT id INTO v_mr_tr1 FROM fee_codes WHERE code = 'MR-TR1';
  SELECT id INTO v_mr_tr2 FROM fee_codes WHERE code = 'MR-TR2';
  SELECT id INTO v_mr_tr3 FROM fee_codes WHERE code = 'MR-TR3';
  SELECT id INTO v_mr_b7 FROM fee_codes WHERE code = 'MR-B7';
  SELECT id INTO v_mr_b5 FROM fee_codes WHERE code = 'MR-B5';

  -- For each Mirai course
  FOR v_course IN
    SELECT c.id, c.code, c.name FROM courses c
    WHERE c.code LIKE 'MIR-%'
  LOOP
    -- Determine tuition rate based on grade
    IF v_course.code IN ('MIR-MON', 'MIR-LKG', 'MIR-UKG', 'MIR-TOD', 'MIR-NUR') THEN
      v_tuition_code := v_mr_cey;
      v_tuition_amount := 21600;
      v_meal_code := v_mr_mey;
      v_meal_amount := 2200;
    ELSE
      v_tuition_code := v_mr_cpy;
      v_tuition_amount := 23800;
      v_meal_code := v_mr_mpy;
      v_meal_amount := 4400;
    END IF;

    -- Check if structure already exists
    SELECT id INTO v_fs_id FROM fee_structures
    WHERE course_id = v_course.id AND session_id = v_session_id AND version = 'new_admission';

    IF v_fs_id IS NULL THEN
      INSERT INTO fee_structures (course_id, session_id, version, is_active)
      VALUES (v_course.id, v_session_id, 'new_admission', true)
      RETURNING id INTO v_fs_id;

      -- One-time fees
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
        (v_fs_id, v_mr_reg, 'registration', 2200, 1),
        (v_fs_id, v_mr_adm, 'admission', 50000, 1),
        (v_fs_id, v_mr_sec, 'admission', 45000, 1);

      -- Quarterly tuition + meals
      FOR q IN 1..4 LOOP
        INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
          (v_fs_id, v_tuition_code, 'q' || q, v_tuition_amount * 3, 10),
          (v_fs_id, v_meal_code, 'q' || q, v_meal_amount * 3, 10);
      END LOOP;

      -- Quarterly transport options
      FOR q IN 1..4 LOOP
        INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
          (v_fs_id, v_mr_tr1, 'q' || q, 4400 * 3, 10),
          (v_fs_id, v_mr_tr2, 'q' || q, 5500 * 3, 10),
          (v_fs_id, v_mr_tr3, 'q' || q, 6800 * 3, 10);
      END LOOP;

      -- Quarterly boarding options
      FOR q IN 1..4 LOOP
        INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
          (v_fs_id, v_mr_b7, 'q' || q, 26000 * 3, 10),
          (v_fs_id, v_mr_b5, 'q' || q, 23000 * 3, 10);
      END LOOP;
    END IF;
  END LOOP;
END $$;
