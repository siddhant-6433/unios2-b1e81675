-- Add Mirai Experiential School fee structures
-- Course codes use MES- prefix (MES-TOD, MES-MON, MES-EYP1-3, MES-PYP1-5)

DO $$
DECLARE
  v_session_id uuid;
  v_fs_id uuid;
  v_course record;
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
  SELECT id INTO v_session_id FROM admission_sessions ORDER BY created_at DESC LIMIT 1;

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

  FOR v_course IN
    SELECT c.id, c.code, c.name FROM courses c WHERE c.code LIKE 'MES-%'
  LOOP
    -- EYP courses (Toddlers, Montessori, EYP1-3) → ₹21,600/mo tuition + ₹2,200/mo breakfast
    -- PYP courses (PYP1-5 = Grade I-V) → ₹23,800/mo tuition + ₹4,400/mo breakfast+lunch
    IF v_course.code IN ('MES-TOD', 'MES-MON', 'MES-EYP1', 'MES-EYP2', 'MES-EYP3') THEN
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

    -- Skip if already exists
    IF EXISTS (SELECT 1 FROM fee_structures WHERE course_id = v_course.id AND session_id = v_session_id AND version = 'new_admission') THEN
      CONTINUE;
    END IF;

    INSERT INTO fee_structures (course_id, session_id, version, is_active)
    VALUES (v_course.id, v_session_id, 'new_admission', true)
    RETURNING id INTO v_fs_id;

    -- One-time fees
    INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
      (v_fs_id, v_mr_reg, 'registration', 2200, 1),
      (v_fs_id, v_mr_adm, 'admission', 50000, 1),
      (v_fs_id, v_mr_sec, 'admission', 45000, 1);

    -- Quarterly: tuition + meals + transport options + boarding options
    FOR q IN 1..4 LOOP
      INSERT INTO fee_structure_items (fee_structure_id, fee_code_id, term, amount, due_day) VALUES
        -- Tuition (monthly × 3)
        (v_fs_id, v_tuition_code, 'q' || q, v_tuition_amount * 3, 10),
        -- Meals (monthly × 3)
        (v_fs_id, v_meal_code, 'q' || q, v_meal_amount * 3, 10),
        -- Transport options
        (v_fs_id, v_mr_tr1, 'q' || q, 4400 * 3, 10),
        (v_fs_id, v_mr_tr2, 'q' || q, 5500 * 3, 10),
        (v_fs_id, v_mr_tr3, 'q' || q, 6800 * 3, 10),
        -- Boarding options
        (v_fs_id, v_mr_b7, 'q' || q, 26000 * 3, 10),
        (v_fs_id, v_mr_b5, 'q' || q, 23000 * 3, 10);
    END LOOP;
  END LOOP;
END $$;
