-- ============================================================
-- Populate: campuses, institutions, departments, courses,
--           eligibility_rules, admission_sessions
-- Source: NIMT Fee Structure 2026-27 & Eligibility Sheet
-- UUID prefixes (all valid hex):
--   Campuses     : c0000001-...
--   Institutions : b0000001-...
--   Departments  : d0000001-...
--   Courses      : a0000001-...
--   Eligibility  : e0000001-...
--   Sessions     : f0000001-...
-- ============================================================

-- ─── CAMPUSES ────────────────────────────────────────────────
INSERT INTO public.campuses (id, name, code, city, state) VALUES
  ('c0000001-0000-0000-0000-000000000001', 'Greater Noida Campus',   'GN', 'Greater Noida', 'Uttar Pradesh'),
  ('c0000001-0000-0000-0000-000000000002', 'Ghaziabad Campus',       'GZ', 'Ghaziabad',     'Uttar Pradesh'),
  ('c0000001-0000-0000-0000-000000000003', 'Kotputli Jaipur Campus', 'KT', 'Kotputli',      'Rajasthan')
ON CONFLICT (code) DO UPDATE SET
  name  = EXCLUDED.name,
  city  = EXCLUDED.city,
  state = EXCLUDED.state;

-- ─── INSTITUTIONS ────────────────────────────────────────────
INSERT INTO public.institutions (id, campus_id, name, code, type) VALUES
  -- Greater Noida
  ('b0000001-0000-0000-0000-000000000001',
   'c0000001-0000-0000-0000-000000000001',
   'NIMT Institute of Medical and Para-Medical Sciences', 'NIMT-IMPS', 'college'),
  ('b0000001-0000-0000-0000-000000000002',
   'c0000001-0000-0000-0000-000000000001',
   'NIMT Hospital', 'NIMT-HOSP', 'college'),
  ('b0000001-0000-0000-0000-000000000003',
   'c0000001-0000-0000-0000-000000000001',
   'NIMT Institute of Education', 'NIMT-EDU-GN', 'college'),
  ('b0000001-0000-0000-0000-000000000004',
   'c0000001-0000-0000-0000-000000000001',
   'Nimt Vidhi Evam Kanun Sansthan', 'NIMT-LAW-GN', 'college'),
  ('b0000001-0000-0000-0000-000000000005',
   'c0000001-0000-0000-0000-000000000001',
   'NIMT Institute of Hospital and Pharma Management', 'NIMT-HPM-GN', 'college'),
  -- Ghaziabad
  ('b0000001-0000-0000-0000-000000000006',
   'c0000001-0000-0000-0000-000000000002',
   'Campus School Dept. of Education', 'GZ-EDU', 'college'),
  ('b0000001-0000-0000-0000-000000000007',
   'c0000001-0000-0000-0000-000000000002',
   'NIMT Institute of Technology and Management', 'GZ-ITM', 'college'),
  -- Kotputli Jaipur
  ('b0000001-0000-0000-0000-000000000008',
   'c0000001-0000-0000-0000-000000000003',
   'Nimt Mahila B.Ed College', 'KT-BED', 'college'),
  ('b0000001-0000-0000-0000-000000000009',
   'c0000001-0000-0000-0000-000000000003',
   'NIMT College of Law, Kotputli Jaipur', 'KT-LAW', 'college'),
  ('b0000001-0000-0000-0000-000000000010',
   'c0000001-0000-0000-0000-000000000003',
   'NIMT Institute of Management', 'KT-MGMT', 'college')
ON CONFLICT (code) DO UPDATE SET
  name      = EXCLUDED.name,
  campus_id = EXCLUDED.campus_id,
  type      = EXCLUDED.type;

-- ─── DEPARTMENTS ─────────────────────────────────────────────
INSERT INTO public.departments (id, institution_id, name, code) VALUES
  -- NIMT-IMPS (Greater Noida)
  ('d0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001', 'Medical Sciences', 'MED-GN'),
  ('d0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000001', 'Nursing',          'NURS-GN'),
  ('d0000001-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000001', 'Pharmacy',         'PHARM-GN'),
  ('d0000001-0000-0000-0000-000000000004', 'b0000001-0000-0000-0000-000000000001', 'Computer Science', 'CS-GN'),
  ('d0000001-0000-0000-0000-000000000005', 'b0000001-0000-0000-0000-000000000001', 'Management',       'MGMT-IMPS'),
  -- NIMT Hospital (Greater Noida)
  ('d0000001-0000-0000-0000-000000000006', 'b0000001-0000-0000-0000-000000000002', 'Medical Sciences', 'MED-HOSP'),
  ('d0000001-0000-0000-0000-000000000007', 'b0000001-0000-0000-0000-000000000002', 'Nursing',          'NURS-HOSP'),
  -- NIMT Education Greater Noida
  ('d0000001-0000-0000-0000-000000000008', 'b0000001-0000-0000-0000-000000000003', 'Education',        'EDU-GN'),
  -- Law Greater Noida
  ('d0000001-0000-0000-0000-000000000009', 'b0000001-0000-0000-0000-000000000004', 'Law',              'LAW-GN'),
  -- NIMT HPM Greater Noida
  ('d0000001-0000-0000-0000-000000000010', 'b0000001-0000-0000-0000-000000000005', 'Management',       'MGMT-HPM'),
  -- Ghaziabad Education
  ('d0000001-0000-0000-0000-000000000011', 'b0000001-0000-0000-0000-000000000006', 'Education',        'EDU-GZ'),
  -- Ghaziabad Management
  ('d0000001-0000-0000-0000-000000000012', 'b0000001-0000-0000-0000-000000000007', 'Management',       'MGMT-GZ'),
  -- Kotputli Education
  ('d0000001-0000-0000-0000-000000000013', 'b0000001-0000-0000-0000-000000000008', 'Education',        'EDU-KT'),
  -- Kotputli Law
  ('d0000001-0000-0000-0000-000000000014', 'b0000001-0000-0000-0000-000000000009', 'Law',              'LAW-KT'),
  -- Kotputli Management
  ('d0000001-0000-0000-0000-000000000015', 'b0000001-0000-0000-0000-000000000010', 'Management',       'MGMT-KT')
ON CONFLICT (id) DO NOTHING;

-- ─── COURSES ─────────────────────────────────────────────────
INSERT INTO public.courses (id, department_id, name, code, duration_years, type) VALUES
  -- MED-GN (NIMT-IMPS)
  ('a0000001-0000-0000-0000-000000000001',
   'd0000001-0000-0000-0000-000000000001',
   'B.Sc in Radiology & Imaging Technology (BMRIT)', 'BMRIT-GN', 4, 'semester'),
  ('a0000001-0000-0000-0000-000000000002',
   'd0000001-0000-0000-0000-000000000001',
   'M.Sc. in Medical Radiology & Imaging Technology (MMRIT)', 'MMRIT-GN', 2, 'semester'),
  ('a0000001-0000-0000-0000-000000000003',
   'd0000001-0000-0000-0000-000000000001',
   'Bachelor of Physiotherapy (BPT)', 'BPT-GN', 5, 'annual'),
  ('a0000001-0000-0000-0000-000000000004',
   'd0000001-0000-0000-0000-000000000001',
   'Masters in Physiotherapy (MPT)', 'MPT-GN', 2, 'semester'),
  -- NURS-GN (NIMT-IMPS)
  ('a0000001-0000-0000-0000-000000000005',
   'd0000001-0000-0000-0000-000000000002',
   'Bachelor of Science in Nursing (B.Sc Nursing)', 'BSCN-GN', 4, 'semester'),
  -- PHARM-GN (NIMT-IMPS)
  ('a0000001-0000-0000-0000-000000000006',
   'd0000001-0000-0000-0000-000000000003',
   'Diploma in Pharmacy (D.Pharma)', 'DPHARMA-GN', 2, 'annual'),
  -- CS-GN (NIMT-IMPS)
  ('a0000001-0000-0000-0000-000000000007',
   'd0000001-0000-0000-0000-000000000004',
   'Bachelor of Computer Application (BCA)', 'BCA-GN', 3, 'semester'),
  -- MGMT-IMPS
  ('a0000001-0000-0000-0000-000000000008',
   'd0000001-0000-0000-0000-000000000005',
   'Bachelor of Business Administration (BBA)', 'BBA-GN', 3, 'semester'),
  -- MED-HOSP (NIMT Hospital)
  ('a0000001-0000-0000-0000-000000000009',
   'd0000001-0000-0000-0000-000000000006',
   'Diploma in Physiotherapy (DPT)', 'DPT-GN', 2, 'annual'),
  ('a0000001-0000-0000-0000-000000000010',
   'd0000001-0000-0000-0000-000000000006',
   'Diploma in Operation Theater Technician (OTT)', 'OTT-GN', 2, 'annual'),
  -- NURS-HOSP
  ('a0000001-0000-0000-0000-000000000011',
   'd0000001-0000-0000-0000-000000000007',
   'General Nursing & Midwifery (GNM)', 'GNM-GN', 3, 'annual'),
  -- EDU-GN
  ('a0000001-0000-0000-0000-000000000012',
   'd0000001-0000-0000-0000-000000000008',
   'Bachelor of Education (B.Ed)', 'BED-GN', 2, 'annual'),
  -- LAW-GN
  ('a0000001-0000-0000-0000-000000000013',
   'd0000001-0000-0000-0000-000000000009',
   'Bachelor of Arts and Bachelor of Laws (BALLB)', 'BALLB-GN', 5, 'semester'),
  ('a0000001-0000-0000-0000-000000000014',
   'd0000001-0000-0000-0000-000000000009',
   'Bachelor of Laws (LLB)', 'LLB-GN', 3, 'annual'),
  -- MGMT-HPM (Greater Noida)
  ('a0000001-0000-0000-0000-000000000015',
   'd0000001-0000-0000-0000-000000000010',
   'Master of Business Administration (MBA)', 'MBA-GN', 2, 'semester'),
  ('a0000001-0000-0000-0000-000000000016',
   'd0000001-0000-0000-0000-000000000010',
   'Post Graduate Diploma in Management (PGDM)', 'PGDM-GN', 2, 'quarterly'),
  -- EDU-GZ (Ghaziabad)
  ('a0000001-0000-0000-0000-000000000017',
   'd0000001-0000-0000-0000-000000000011',
   'Bachelor of Education (B.Ed)', 'BED-GZ', 2, 'annual'),
  ('a0000001-0000-0000-0000-000000000018',
   'd0000001-0000-0000-0000-000000000011',
   'Diploma in Elementary Education (D.El.Ed)', 'DELED-GZ', 2, 'semester'),
  -- MGMT-GZ (Ghaziabad)
  ('a0000001-0000-0000-0000-000000000019',
   'd0000001-0000-0000-0000-000000000012',
   'Post Graduate Diploma in Management (PGDM)', 'PGDM-GZ', 2, 'quarterly'),
  -- EDU-KT (Kotputli)
  ('a0000001-0000-0000-0000-000000000020',
   'd0000001-0000-0000-0000-000000000013',
   'Bachelor of Education (B.Ed)', 'BED-KT', 2, 'annual'),
  -- LAW-KT (Kotputli)
  ('a0000001-0000-0000-0000-000000000021',
   'd0000001-0000-0000-0000-000000000014',
   'Bachelor of Laws (LLB)', 'LLB-KT', 3, 'annual'),
  -- MGMT-KT (Kotputli)
  ('a0000001-0000-0000-0000-000000000022',
   'd0000001-0000-0000-0000-000000000015',
   'Post Graduate Diploma in Management (PGDM)', 'PGDM-KT', 2, 'quarterly')
ON CONFLICT (code) DO UPDATE SET
  name           = EXCLUDED.name,
  department_id  = EXCLUDED.department_id,
  duration_years = EXCLUDED.duration_years,
  type           = EXCLUDED.type;

-- ─── ELIGIBILITY RULES ───────────────────────────────────────
-- Use subqueries to resolve course_id by code (works even if
-- courses already existed with different UUIDs).
DO $$
DECLARE
  v_course_id uuid;
BEGIN
  -- helper: upsert one eligibility rule by course code
  -- BMRIT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BMRIT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, NULL, NULL, false, 'Combined Paramedical Entrance Test (CPET)', true, ARRAY['Physics','Chemistry','Biology'], '10+2 PCB required. Lateral entry to 2nd year for Diploma holders in same discipline. Intake: 40.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='Combined Paramedical Entrance Test (CPET)', entrance_exam_required=true, subject_prerequisites=ARRAY['Physics','Chemistry','Biology'], notes='10+2 PCB required. Lateral entry to 2nd year for Diploma holders in same discipline. Intake: 40.', updated_at=now();
  END IF;

  -- MMRIT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MMRIT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, NULL, 50, true, 'Combined Paramedical Masters Entrance', false, ARRAY['B.Sc MRIT or equivalent B.Sc'], 'B.Sc MRIT with min 50% or any B.Sc with 60% aggregate. Intake: 20.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='Combined Paramedical Masters Entrance', entrance_exam_required=false, subject_prerequisites=ARRAY['B.Sc MRIT or equivalent B.Sc'], notes='B.Sc MRIT with min 50% or any B.Sc with 60% aggregate. Intake: 20.', updated_at=now();
  END IF;

  -- BPT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, 50, NULL, false, 'Combined Paramedical Entrance Test (CPET)', true, ARRAY['Physics','Chemistry','Biology'], '10+2 PCB with 50% aggregate (40% SC/ST/PwD). English pass required. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=50, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='Combined Paramedical Entrance Test (CPET)', entrance_exam_required=true, subject_prerequisites=ARRAY['Physics','Chemistry','Biology'], notes='10+2 PCB with 50% aggregate (40% SC/ST/PwD). English pass required. Intake: 60.', updated_at=now();
  END IF;

  -- MPT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, NULL, 50, true, 'Combined Paramedical Masters Entrance', false, ARRAY['BPT with 6 months internship'], 'BPT with minimum 50% aggregate and 6 months compulsory internship.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='Combined Paramedical Masters Entrance', entrance_exam_required=false, subject_prerequisites=ARRAY['BPT with 6 months internship'], notes='BPT with minimum 50% aggregate and 6 months compulsory internship.', updated_at=now();
  END IF;

  -- B.Sc Nursing
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BSCN-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, 35, 45, NULL, false, 'ABVMUP Combined Nursing Entrance Test (CNET)', true, ARRAY['Physics','Chemistry','Biology','English'], '10+2 PCB with min 45% (40% SC/ST). English compulsory. Max age 35 (40 for PwD). Intake: 40.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=35, class_12_min_marks=45, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='ABVMUP Combined Nursing Entrance Test (CNET)', entrance_exam_required=true, subject_prerequisites=ARRAY['Physics','Chemistry','Biology','English'], notes='10+2 PCB with min 45% (40% SC/ST). English compulsory. Max age 35 (40 for PwD). Intake: 40.', updated_at=now();
  END IF;

  -- D.Pharma
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPHARMA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, NULL, false, 'JEECUP (UP Polytechnic) / NIMT Admission Test (NAT)', true, ARRAY['Physics','Chemistry','Biology or Mathematics'], '10+2 Science with PCB or PCM. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='JEECUP (UP Polytechnic) / NIMT Admission Test (NAT)', entrance_exam_required=true, subject_prerequisites=ARRAY['Physics','Chemistry','Biology or Mathematics'], notes='10+2 Science with PCB or PCM. Intake: 60.', updated_at=now();
  END IF;

  -- BCA
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BCA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, 50, NULL, false, 'CUET UG', false, ARRAY['Any Stream 10+2'], '10+2 any stream with 50% marks. Intake: 120.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=50, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='CUET UG', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Stream 10+2'], notes='10+2 any stream with 50% marks. Intake: 120.', updated_at=now();
  END IF;

  -- BBA
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BBA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, 50, NULL, false, 'CUET UG', false, ARRAY['Any Stream 10+2'], '10+2 any stream with 50% marks. Intake: 120.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=50, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='CUET UG', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Stream 10+2'], notes='10+2 any stream with 50% marks. Intake: 120.', updated_at=now();
  END IF;

  -- DPT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DPT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, 35, NULL, false, 'NEET / NIMT Admission Test (NAT)', false, ARRAY['Physics','Chemistry','Biology or Mathematics'], '10+2 PCB or PCM with min 35% aggregate. Intake: 30.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=35, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='NEET / NIMT Admission Test (NAT)', entrance_exam_required=false, subject_prerequisites=ARRAY['Physics','Chemistry','Biology or Mathematics'], notes='10+2 PCB or PCM with min 35% aggregate. Intake: 30.', updated_at=now();
  END IF;

  -- OTT
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'OTT-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, NULL, 35, NULL, false, 'NEET / NIMT Admission Test (NAT)', false, ARRAY['Physics','Chemistry','Biology or Mathematics'], '10+2 PCB or PCM with min 35% aggregate. Intake: 30.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=NULL, class_12_min_marks=35, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='NEET / NIMT Admission Test (NAT)', entrance_exam_required=false, subject_prerequisites=ARRAY['Physics','Chemistry','Biology or Mathematics'], notes='10+2 PCB or PCM with min 35% aggregate. Intake: 30.', updated_at=now();
  END IF;

  -- GNM
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'GNM-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, 17, 35, 40, NULL, false, 'UP GNM Entrance Test (UPGET)', true, ARRAY['English','Any Stream 10+2'], '10+2 with English and min 40% marks. ANM registered also eligible. 5% relaxation SC/ST. Intake: 30.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=17, max_age=35, class_12_min_marks=40, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='UP GNM Entrance Test (UPGET)', entrance_exam_required=true, subject_prerequisites=ARRAY['English','Any Stream 10+2'], notes='10+2 with English and min 40% marks. ANM registered also eligible. 5% relaxation SC/ST. Intake: 30.', updated_at=now();
  END IF;

  -- B.Ed Greater Noida
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'UP B.Ed Joint Entrance Exam (JEE B.Ed)', true, ARRAY['Any Graduate'], 'Graduate with min 50% (Gen/OBC). B.E/B.Tech 55%. SC/ST no minimum %. Intake: 100.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='UP B.Ed Joint Entrance Exam (JEE B.Ed)', entrance_exam_required=true, subject_prerequisites=ARRAY['Any Graduate'], notes='Graduate with min 50% (Gen/OBC). B.E/B.Tech 55%. SC/ST no minimum %. Intake: 100.', updated_at=now();
  END IF;

  -- BALLB
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BALLB-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, 44.5, NULL, false, 'CLAT / LSAT / NIMT Admission Test (NAT)', false, ARRAY['Any Stream 10+2'], '10+2 any stream with 44.5% (Gen), 42% (OBC), 39.5% (SC/ST). CLAT preferred. Intake: 120.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=44.5, graduation_min_marks=NULL, requires_graduation=false, entrance_exam_name='CLAT / LSAT / NIMT Admission Test (NAT)', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Stream 10+2'], notes='10+2 any stream with 44.5% (Gen), 42% (OBC), 39.5% (SC/ST). CLAT preferred. Intake: 120.', updated_at=now();
  END IF;

  -- LLB Greater Noida
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 45, true, 'CLAT / LSAT / NIMT Admission Test (NAT)', false, ARRAY['Any Graduate'], 'Any bachelor''s degree with min 45% (Gen), 42% (OBC), 40% (SC/ST). CLAT preferred. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=45, requires_graduation=true, entrance_exam_name='CLAT / LSAT / NIMT Admission Test (NAT)', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='Any bachelor''s degree with min 45% (Gen), 42% (OBC), 40% (SC/ST). CLAT preferred. Intake: 60.', updated_at=now();
  END IF;

  -- MBA
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'MBA-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'CAT / MAT / UPSEE / GMAT', false, ARRAY['Any Graduate'], 'Bachelor degree min 3 years with 50% (45% for SC/ST). CAT preferred. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='CAT / MAT / UPSEE / GMAT', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='Bachelor degree min 3 years with 50% (45% for SC/ST). CAT preferred. Intake: 60.', updated_at=now();
  END IF;

  -- PGDM Greater Noida
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-GN';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'CAT / MAT / GMAT', false, ARRAY['Any Graduate'], 'UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='CAT / MAT / GMAT', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 60.', updated_at=now();
  END IF;

  -- B.Ed Ghaziabad
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'UP B.Ed Joint Entrance Exam (JEE B.Ed)', true, ARRAY['Any Graduate'], 'Graduate with min 50% (Gen/OBC). B.E/B.Tech 55%. SC/ST no minimum %. Intake: 100.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='UP B.Ed Joint Entrance Exam (JEE B.Ed)', entrance_exam_required=true, subject_prerequisites=ARRAY['Any Graduate'], notes='Graduate with min 50% (Gen/OBC). B.E/B.Tech 55%. SC/ST no minimum %. Intake: 100.', updated_at=now();
  END IF;

  -- D.El.Ed Ghaziabad
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'DELED-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, NULL, true, 'UP D.El.Ed Counselling', true, ARRAY['Any Graduate'], 'Graduate or equivalent. Admitted via UP Basic Education Board counselling. Intake: 50.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=NULL, requires_graduation=true, entrance_exam_name='UP D.El.Ed Counselling', entrance_exam_required=true, subject_prerequisites=ARRAY['Any Graduate'], notes='Graduate or equivalent. Admitted via UP Basic Education Board counselling. Intake: 50.', updated_at=now();
  END IF;

  -- PGDM Ghaziabad
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-GZ';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'CAT / MAT / GMAT', false, ARRAY['Any Graduate'], 'UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 120.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='CAT / MAT / GMAT', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 120.', updated_at=now();
  END IF;

  -- B.Ed Kotputli
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'BED-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'PTET Entrance Exam', true, ARRAY['Any Graduate'], 'Female candidates only. Graduate with 50% (45% OBC, 40% SC/ST). Intake: 100.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='PTET Entrance Exam', entrance_exam_required=true, subject_prerequisites=ARRAY['Any Graduate'], notes='Female candidates only. Graduate with 50% (45% OBC, 40% SC/ST). Intake: 100.', updated_at=now();
  END IF;

  -- LLB Kotputli
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'LLB-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 45, true, 'CLAT / LSAT / NIMT Admission Test (NAT)', false, ARRAY['Any Graduate'], 'Any bachelor''s degree with 45% (Gen), 40% (SC/ST/OBC). CLAT preferred. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=45, requires_graduation=true, entrance_exam_name='CLAT / LSAT / NIMT Admission Test (NAT)', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='Any bachelor''s degree with 45% (Gen), 40% (SC/ST/OBC). CLAT preferred. Intake: 60.', updated_at=now();
  END IF;

  -- PGDM Kotputli
  SELECT id INTO v_course_id FROM public.courses WHERE code = 'PGDM-KT';
  IF v_course_id IS NOT NULL THEN
    INSERT INTO public.eligibility_rules (course_id, min_age, max_age, class_12_min_marks, graduation_min_marks, requires_graduation, entrance_exam_name, entrance_exam_required, subject_prerequisites, notes)
    VALUES (v_course_id, NULL, NULL, NULL, 50, true, 'CAT / MAT / GMAT', false, ARRAY['Any Graduate'], 'UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 60.')
    ON CONFLICT (course_id) DO UPDATE SET min_age=NULL, max_age=NULL, class_12_min_marks=NULL, graduation_min_marks=50, requires_graduation=true, entrance_exam_name='CAT / MAT / GMAT', entrance_exam_required=false, subject_prerequisites=ARRAY['Any Graduate'], notes='UG degree with 50% (45% SC/ST/OBC). SOP required. CAT preferred. Intake: 60.', updated_at=now();
  END IF;

END $$;

-- ─── ADMISSION SESSION 2026-27 ───────────────────────────────
INSERT INTO public.admission_sessions (id, name, start_date, end_date, is_active) VALUES
  ('f0000001-0000-0000-0000-000000000001',
   'Academic Year 2026-27',
   '2026-06-01',
   '2027-05-31',
   true)
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date   = EXCLUDED.end_date,
  is_active  = EXCLUDED.is_active;
