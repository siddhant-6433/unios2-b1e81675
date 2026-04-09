-- Sync courses.duration_years and courses.type for all NIMT college courses
-- from Updated Eligibility.xlsx → Sheet66 (COURSE DURATION + EXAM MODE columns).

UPDATE public.courses SET duration_years = 4, type = 'semester'  WHERE code = 'BMRIT-GN';
UPDATE public.courses SET duration_years = 2, type = 'semester'  WHERE code = 'MMRIT-GN';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'DPT-GN';
UPDATE public.courses SET duration_years = 5, type = 'annual'    WHERE code = 'BPT-GN';
UPDATE public.courses SET duration_years = 2, type = 'semester'  WHERE code = 'MPT-GN';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'OTT-GN';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'DPHARMA-GN';
UPDATE public.courses SET duration_years = 4, type = 'semester'  WHERE code = 'BSCN-GN';
UPDATE public.courses SET duration_years = 3, type = 'annual'    WHERE code = 'GNM-GN';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'BED-GN';
UPDATE public.courses SET duration_years = 2, type = 'semester'  WHERE code = 'DELED-GZ';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'BED-GZ';
UPDATE public.courses SET duration_years = 2, type = 'annual'    WHERE code = 'BED-KT';
UPDATE public.courses SET duration_years = 5, type = 'semester'  WHERE code = 'BALLB-GN';
UPDATE public.courses SET duration_years = 3, type = 'annual'    WHERE code = 'LLB-GN';
UPDATE public.courses SET duration_years = 3, type = 'annual'    WHERE code = 'LLB-KT';
UPDATE public.courses SET duration_years = 2, type = 'semester'  WHERE code = 'MBA-GN';
UPDATE public.courses SET duration_years = 2, type = 'trimester' WHERE code = 'PGDM-GN';
UPDATE public.courses SET duration_years = 2, type = 'trimester' WHERE code = 'PGDM-GZ';
UPDATE public.courses SET duration_years = 2, type = 'trimester' WHERE code = 'PGDM-KT';
UPDATE public.courses SET duration_years = 3, type = 'semester'  WHERE code = 'BBA-GN';
UPDATE public.courses SET duration_years = 3, type = 'semester'  WHERE code = 'BCA-GN';

-- Also sync intake into eligibility_rules.notes for all courses
-- (replaces old intake value if present, appends if not)
DO $$
DECLARE v_course_id uuid;
BEGIN
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BMRIT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 40.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 40.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MMRIT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 20.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 20.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 30.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 30.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BPT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MPT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 20.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 20.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'OTT-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 30.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 30.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPHARMA-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BSCN-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 40.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 40.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'GNM-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 30.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 30.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 100.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 100.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DELED-GZ';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 50.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 50.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GZ';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 100.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 100.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-KT';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 100.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 100.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BALLB-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 120.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 120.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-KT';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MBA-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-GZ';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 120.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 120.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-KT';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 60.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 60.',                                     updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BBA-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 120.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 120.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BCA-GN';
  UPDATE public.eligibility_rules SET notes = regexp_replace(notes, 'Intake: \d+\.?', 'Intake: 120.', 'g'), updated_at = now() WHERE course_id = v_course_id AND notes LIKE '%Intake:%';
  UPDATE public.eligibility_rules SET notes = notes || ' Intake: 120.',                                      updated_at = now() WHERE course_id = v_course_id AND notes NOT LIKE '%Intake:%';

END $$;
