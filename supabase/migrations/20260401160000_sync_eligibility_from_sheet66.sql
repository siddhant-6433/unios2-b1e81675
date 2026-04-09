-- Sync eligibility_rules to match Updated Eligibility.xlsx → Sheet66.
--
-- Key changes vs current DB:
--  • BMRIT/BPT: entrance exam listed as NA (not CPET) in sheet
--  • DPT/OTT: entrance exam listed as NA (not NEET/NAT) in sheet
--  • D.Pharma: entrance exam = JEECUP only (remove NAT suffix)
--  • MPT: add missing Intake: 20 to notes
--  • B.Ed / D.El.Ed / PTET: entrance exam text matches sheet wording
--  • Law / PGDM / MBA: minor formatting alignment
--
-- Course type (EXAM MODE) already correct from previous migrations.
-- Intake numbers already correct in notes for all courses except MPT.

DO $$
DECLARE v_course_id uuid;
BEGIN

  -- BMRIT: entrance = NA (sheet says no named exam), still mandatory
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BMRIT-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = NULL,
        entrance_exam_required = true,
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- DPT: entrance = NA, non-mandatory
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPT-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = NULL,
        entrance_exam_required = false,
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- BPT: entrance = NA, mandatory
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BPT-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = NULL,
        entrance_exam_required = true,
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- OTT: entrance = NA, non-mandatory
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'OTT-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = NULL,
        entrance_exam_required = false,
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- D.Pharma: JEECUP only (remove NIMT NAT suffix), mandatory
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPHARMA-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'JEECUP (UP Polytechnic)',
        entrance_exam_required = true,
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- MPT: add Intake: 20 to notes (was missing)
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MPT-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET notes = 'BPT with minimum 50% aggregate and 6 months compulsory internship. Intake: 20.',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- MMRIT: intake already in notes, entrance unchanged
  -- B.Sc Nursing: no change needed
  -- GNM: no change needed

  -- B.Ed Greater Noida: align exam name to sheet wording
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'Admission via UP B.Ed Joint Entrance Exam (JEEB.Ed)',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- B.Ed Ghaziabad: align exam name
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GZ';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'Admission via UP B.Ed Joint Entrance Exam (JEEB.Ed)',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- D.El.Ed: align exam name
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DELED-GZ';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'Admission via UP D.El.Ed Counselling',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- B.Ed Kotputli: align exam name
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-KT';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'Admission via PTET Entrance Exam',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- BALLB: align exam name format (commas instead of slashes)
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BALLB-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'CLAT, LSAT, NIMT Admission Test (NAT)',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- LLB Greater Noida: align exam name
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-GN';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'CLAT, LSAT, NIMT Admission Test (NAT)',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

  -- LLB Kotputli: align exam name
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-KT';
  IF v_course_id IS NOT NULL THEN
    UPDATE public.eligibility_rules
    SET entrance_exam_name = 'CLAT, LSAT, NIMT Admission Test (NAT)',
        updated_at = now()
    WHERE course_id = v_course_id;
  END IF;

END $$;
