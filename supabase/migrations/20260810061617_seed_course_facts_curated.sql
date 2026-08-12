-- course_facts: the single source of truth for student-facing course information.
--
-- Before this, four surfaces each read a different field and disagreed:
--   website               -> courses.eligibility
--   counsellor Course tab -> eligibility_rules.*
--   WhatsApp templates    -> courses.marketing_eligibility
--   Navya                 -> hardcoded COURSE_KNOWLEDGE / KNOWLEDGE_BASE in code
-- An audit across all 64 courses found 72 material conflicts. LLB was advertised
-- over WhatsApp as "10+2 with min 50%" when it is graduate-entry; BBA first-year
-- fee read 70,000 / 55,000 / 75,000 depending on which surface you asked.
--
-- Deliberately text, not structured: the curated answers are prose ("Minimum age
-- 17 on or before 31st December, no upper limit", "800/month", "Stetho Batch
-- total fee Rs 1,85,000 across 5 semesters..."). The existing structured columns
-- (courses.duration_years, eligibility_rules.*, the fee ledger) stay as they are
-- and remain the source for COMPUTATION. course_facts is the source for DISPLAY.

CREATE TABLE IF NOT EXISTS public.course_facts (
  course_id        uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  duration         text,
  eligibility      text,
  entrance_exam    text,
  affiliation      text,
  age_requirement  text,
  intake_seats     text,
  subjects         text,
  fee_first_year   text,
  source           text NOT NULL DEFAULT 'admissions_curated_2026_27',
  verified_at      timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_facts IS
  'Single source of truth for student-facing course information. Curated by admissions and rendered by the website, the counsellor Course tab, WhatsApp templates and Navya. Structured columns elsewhere remain the source for computation.';
COMMENT ON COLUMN public.course_facts.fee_first_year IS
  'Display text, not a number - formats legitimately vary (75,000 / Rs 1,53,000 per year / 800/month / multi-semester breakdowns). Fee computation still uses the fee ledger.';

ALTER TABLE public.course_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read course_facts" ON public.course_facts;
CREATE POLICY "Staff can read course_facts"
  ON public.course_facts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'accountant'::public.app_role) OR
    public.has_role(auth.uid(), 'teacher'::public.app_role) OR
    public.has_role(auth.uid(), 'faculty'::public.app_role)
  );

-- Write: admissions leadership only. This is what students are told.
DROP POLICY IF EXISTS "Admins can manage course_facts" ON public.course_facts;
CREATE POLICY "Admins can manage course_facts"
  ON public.course_facts FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  );

GRANT SELECT ON public.course_facts TO authenticated;

DROP TRIGGER IF EXISTS trg_course_facts_updated_at ON public.course_facts;
CREATE TRIGGER trg_course_facts_updated_at
  BEFORE UPDATE ON public.course_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed course_facts with the admissions-curated 2026-27 values.
--
-- Source: data/COURSE_SOURCE_OF_TRUTH_REVIEW.csv, reconciled row by row by
-- admissions against the fee-structure workbook and returned as
-- "Course Details - Sheet1.csv". 337 values across all 64 courses.
--
-- MES-TOD duration and eligibility are deliberately absent: those two cells were
-- shifted one row up in the source sheet (duration held an entrance-exam string,
-- eligibility held a fee), so they are left blank rather than guessed.

INSERT INTO public.course_facts
  (course_id, duration, eligibility, entrance_exam, affiliation, age_requirement, intake_seats, subjects, fee_first_year)
SELECT c.id, v.duration, v.eligibility, v.entrance_exam, v.affiliation, v.age_requirement, v.intake_seats, v.subjects, v.fee_first_year
FROM (VALUES
('BALLB-GN', '5 Years (10 Semesters)', '10+2 with 45% marks for Gen. 42% marks for OBC and 40% marks for SC/ST.', 'CLAT, LSAT Scores Preferred. Entrance is not mandatory.', 'CCS University Meerut, Bar Coucil of India', 'No Restriction', '120', '10 + 2 Any Stream', '1,10,000'),
('BBA-GN', '3 Years (6 Semesters)', '10+2 (All streams) with 45% marks for Gen./OBC and 40% marks for SC/ST.', 'CUET UG Accepted. Entrance not mandatory.', 'Chaudhary Charan Singh University | All India Council for Technical Education', 'No Restriction', '120', '10 + 2 Any Stream', '75,000'),
('BCA-GN', '3 Years (6 Semesters)', '10+2 with 45% marks for GEN/OBC and for SC/ST 40% marks (Art with maths)/Ag/Bio/Science/Commerce) Maths mandatory at High School Or Intermediate.', 'CUET UG Accepted. Entrance not mandatory.', 'Chaudhary Charan Singh University | All India Council for Technical Education', 'No Restriction', '120', '10 + 2 Any Stream', '75,000'),
('BED-GN', '2 Years (4 Semesters)', 'Arts/Science/Humanities graduates: min 50% (45% SC/ST). B.E./B.Tech: min 55%.', 'UP B.Ed Joint Entrance Examination (JEE B.Ed UP).', 'Chaudhary Charan Singh University | National Council for Teacher Education', 'No Restriction', '100', 'Any Graduate', '51,250'),
('BED-GZ', '2 Years (4 Semesters)', 'Arts/Science/Humanities graduates: min 50% (45% SC/ST). B.E./B.Tech: min 55%.', 'UP B.Ed Joint Entrance Examination (JEE B.Ed UP).', 'Chaudhary Charan Singh University | National Council for Teacher Education', 'No Restriction', '100', 'Any Graduate', '51,250'),
('BED-KT', '2 Years (4 Semesters)', 'Arts/Science/Humanities graduates: min 50% (45% SC/ST). B.E./B.Tech: min 55%.', 'PTET', 'University of Rajasthan | National Council for Teacher Education', 'No Restriction', '100', 'Any Graduate', '27,000'),
('BMRIT-GN', '4 Years (3 Years + 1 Year Internship)', '10+2 with Physics, Chemistry, Biology and English pass. Minimum 50% PCB aggregate; 40% for SC/ST/OBC-NCL/PwD. ISCO Code 3211.', 'UP 2026-27: CAHET counselling by ABVMU Lucknow; NEET UG exempt this year', 'Atal Bihari Vajpayee Medical University, Lucknow', 'Minimum age for admission is 17 years on or before 31st December of admission year. No upper age limit.', '50', 'Physics, Chemistry & Biology', '92,000'),
('BPT-GN', '5 Years (4 academic years + 1-year compulsory internship)', '10+2 or equivalent with Physics, Chemistry, Biology (or Botany & Zoology) and English pass. Minimum 50% PCB aggregate; 40% for SC/ST/OBC-NCL/PwD. Minimum age 17.', 'UP 2026-27: CAHET counselling by ABVMU Lucknow; NEET UG exempt this year', 'Atal Bihari Vajpayee Medical University, Lucknow', 'Minimum age for admission is 17 years on or before 31st December of admission year. No upper age limit.', '50', 'Physics, Chemistry & Biology', '92,000'),
('BSA-G1', 'Academic Session is from April to March next year', 'Qualified Grade Kindergarten, Minimum Age : 6 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '800/month'),
('BSA-G10', 'Academic Session is from April to March next year', 'Qualified Grade 9, Minimum Age : 14 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '1450/month'),
('BSA-G2', 'Academic Session is from April to March next year', 'Qualified Grade 1, Minimum Age : 7 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '950/month'),
('BSA-G3', 'Academic Session is from April to March next year', 'Qualified Grade 2, Minimum Age : 8 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '950/month'),
('BSA-G4', 'Academic Session is from April to March next year', 'Qualified Grade 3, Minimum Age : 9 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '950/month'),
('BSA-G5', 'Academic Session is from April to March next year', 'Qualified Grade 4, Minimum Age : 10 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '950/month'),
('BSA-G6', 'Academic Session is from April to March next year', 'Qualified Grade 5, Minimum Age : 10 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '1450/month'),
('BSA-G7', 'Academic Session is from April to March next year', 'Qualified Grade 6, Minimum Age : 11 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '1450/month'),
('BSA-G8', 'Academic Session is from April to March next year', 'Qualified Grade 7, Minimum Age : 12 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '1450/month'),
('BSA-G9', 'Academic Session is from April to March next year', 'Qualified Grade 8, Minimum Age : 13 years', 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, '1450/month'),
('BSA-LKG', '1 Year', NULL, 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, NULL),
('BSA-NUR', '1 Year', NULL, 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, NULL),
('BSA-TOD', '1 Year', NULL, 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, NULL),
('BSA-UKG', '1 Year', NULL, 'Interaction and age-appropriate assessment', NULL, NULL, NULL, NULL, NULL),
('BSAV-G1', 'Academic Session is from April to March next year', 'Qualified Grade Kindergarten, Minimum Age : 6 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '4,667/month'),
('BSAV-G10', 'Academic Session is from April to March next year', 'Qualified Grade 9, Minimum Age : 14 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '6,000/month'),
('BSAV-G11', 'Academic Session is from April to March next year', 'Qualified Grade Kindergarten, No age restriction', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '7,500/month'),
('BSAV-G12', 'Academic Session is from April to March next year', 'Qualified Grade Kindergarten, No age restriction', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '7,500/month'),
('BSAV-G2', 'Academic Session is from April to March next year', 'Qualified Grade 1, Minimum Age : 7 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '4,667/month'),
('BSAV-G3', 'Academic Session is from April to March next year', 'Qualified Grade 2, Minimum Age : 8 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '4,667/month'),
('BSAV-G4', 'Academic Session is from April to March next year', 'Qualified Grade 3, Minimum Age : 9 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '4,667/month'),
('BSAV-G5', 'Academic Session is from April to March next year', 'Qualified Grade 4, Minimum Age : 10 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '4,667/month'),
('BSAV-G6', 'Academic Session is from April to March next year', 'Qualified Grade 5, Minimum Age : 10 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '5,000/month'),
('BSAV-G7', 'Academic Session is from April to March next year', 'Qualified Grade 6, Minimum Age : 11 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '5,000/month'),
('BSAV-G8', 'Academic Session is from April to March next year', 'Qualified Grade 7, Minimum Age : 12 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '5,000/month'),
('BSAV-G9', 'Academic Session is from April to March next year', 'Qualified Grade 8, Minimum Age : 12 years', 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, '5,000/month'),
('BSAV-LKG', '1 Year', NULL, 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, NULL),
('BSAV-NUR', '1 Year', NULL, 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, NULL),
('BSAV-TOD', '1 Year', NULL, 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, NULL),
('BSAV-UKG', '1 Year', NULL, 'Interaction and age-appropriate assessment', 'CBSE. Affiliation No 2131310', NULL, NULL, NULL, NULL),
('BSCN-GN', '4 Years (8 Semesters)', '10+2 with Physics, Chemistry, Biology and English. Minimum 45% aggregate from any recognised board. Minimum age 17 on 31 Dec. Must be medically fit.', 'CNET (Combined Nursing Entrance Test)', 'Atal Bihari Vajpayee Medical University, Lucknow | Indian Nursing Council', '1. Minimum age for admission is 17 years on or before 31st December of admission year. 2. The maximum age limit for admission is 35 years for Unreserved (UR), OBC, EWS, SC and ST, however the maximum age for candidates with Physical Disability (PD/PwD) will be 40 years. (As per INC regulation).', '40', 'Physics, Chemistry, Biology, English', 'Rs 1,53,000 per year (first year fee)'),
('DAOTT-GN', '2.5 Years (5 semesters)', '10+2 with Operation Theatre relevant subjects. ISCO Code 3259.', 'Admission on the basis of merit of Secondary (10+2).', 'Uttar Pradesh State Medical Faculty, Lucknow', '17 years completed (or turning 17 by December 31 of the year of enrollment)', '30', 'Physics, Chemistry, Biology or Mathematics', 'Stetho Batch total fee Rs 1,85,000 across 5 semesters: Sem 1 Rs 40,000, Sem 2 Rs 40,000, Sem 3 Rs 40,000, Sem 4 Rs 40,000, Sem 5 Rs 25,000.'),
('DELED-GZ', '2 Years (4 Semesters)', 'Candidates must hold a Bachelor’s degree with a minimum of 50% marks (45% for SC/ST/OBC/PH) and be between 18 and 35 years old as of July 1st of the admission year', 'Admission via UP D.El.Ed Counselling', 'Examination Regulatory Authority Uttar Pradesh | National Council for Teacher Education', 'No Restriction', '50', 'Any Graduate', '41000'),
('DPHARMA-GN', '2 Years', 'A pass in the 10+2 (science academic stream) examination with Physics, Chemistry, and Biology or Mathematics, or an equivalent qualification approved by the PCI', 'JEECUP', 'Pharmacy Council of India | Board of Technical Education, Uttar Pradesh', '17 years completed (or turning 17 by December 31 of the year of enrollment)', '60', 'Physics, Chemistry, Biology or Mathematics', '95,000'),
('DPT-GN', '2 Years (Annual)', NULL, 'None', 'Uttar Pradesh State Medical Faculty, Lucknow', NULL, NULL, 'Physics, Chemistry, Biology or Mathematics', '95000'),
('GNM-GN', '3 Years + 6-month Internship', '10+2 with English, scoring at least 40% aggregate and individualy for English from a recognized board (State Open Schools and NIOS are accepted)', 'UP GNM Entrance Test (UPGET)', 'Uttar Pradesh State Medical Faculty | Indian Nursing Council', 'The minimum age for admission shall be 17 years on 31st December of the year in which admission is sought. The maximum age limit is 35 years. For ANM/ for LHV, there is no age bar.', '30', '10+2 (English Subject Mandatory with Any Stream) OR ANM', '1,18,000'),
('LLB-GN', '3 Years (6 Semesters)', 'Candidates need a graduation or post-graduation degree with at least 45% marks (40% for SC/ST, 42% or as per state rules for OBC) to be eligible', 'None', 'Chaudhary Charan Singh University | Bar Council of India', 'No Restriction', '60', 'Any Graduate', '44,250'),
('LLB-KT', '3 Years (6 Semesters)', 'Candidates need a graduation or post-graduation degree with at least 45% marks (40% for SC/ST, 42% or as per state rules for OBC) to be eligible', 'None', 'Dr. Bhimrao Ambedkar Law University, Jaipur | Bar Council of India', 'No Restriction', '120', 'Any Graduate', '44,250'),
('MBA-GN', '2 Years (4 Semesters)', 'Requires a minimum 3-year bachelor''s degree from a recognized university with at least 50% marks (45% for reserved categories)', 'CUET PG, CAT, MAT, GMAT Accepted. Entrance is not mandatory.', 'Dr. A.P.J. Abdul Kalam Technical University, Lucknow | All India Council for Technical Education', 'No Restriction', '60', 'Any Graduate', '1,30,000'),
('MES-EYP1', '1 Year', 'Minimum age: 3 years plus', NULL, NULL, 'Minimum age: 3 years plus', NULL, NULL, NULL),
('MES-EYP2', '1 Year', 'Minimum age: 4 years plus', NULL, NULL, 'Minimum age: 4 years plus', NULL, NULL, NULL),
('MES-EYP3', '1 Year', 'Minimum age: 5 years plus', NULL, NULL, 'Minimum age: 5 years plus', NULL, NULL, NULL),
('MES-MON', '1 Year', 'Minimum age: 2 years plus', NULL, NULL, 'Minimum age: 2 years plus', NULL, NULL, NULL),
('MES-MYP1', '1 year (annual)', 'Approximate Age: 10 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 11 years plus', NULL, NULL, NULL),
('MES-MYP2', '1 year (annual)', 'Approximate Age: 11 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 12 years plus', NULL, NULL, NULL),
('MES-MYP3', '1 year (annual)', 'Approximate Age: 12 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 13 years plus', NULL, NULL, NULL),
('MES-PYP1', '1 year (annual)', 'Approximate Age: 6 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 6 years plus', NULL, NULL, '23,800/month'),
('MES-PYP2', '1 year (annual)', 'Approximate Age: 7 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 7 years plus', NULL, NULL, '23,800/month'),
('MES-PYP3', '1 year (annual)', 'Approximate Age: 8 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 8 years plus', NULL, NULL, '23,800/month'),
('MES-PYP4', '1 year (annual)', 'Approximate Age: 9 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 9 years plus', NULL, NULL, '23,800/month'),
('MES-PYP5', '1 year (annual)', 'Approximate Age: 10 Years', 'Interaction and age-appropriate assessment', NULL, 'Minimum age: 10 years plus', NULL, NULL, '23,800/month'),
('MES-TOD', NULL, NULL, NULL, NULL, 'Minimum age: 2 years plus', NULL, NULL, NULL),
('MMRIT-GN', '2 Years (4 Semester)', 'Candidates with B.Sc. in Medical Radiology & Imaging Technology / B.Sc. in Medical Technology Radio Diagnosis & Imaging / B.Sc. Radiology Technology / B.Sc. in Radiography / B.Sc. Medical Technology (X-ray) with minimum 50% aggregate.', 'Combined Paramedical Masters Entrance', 'Atal Bihari Vajpayee Medical University, Lucknow', 'Minimum age for admission is 17 years on or before 31st December of admission year. No upper age limit.', '20', 'B.Sc MRIT or equivalent B.Sc', '80000'),
('MPT-GN', '2 Years (4 Semester)', 'Candidates with Bachelor of Physiotherapy (BPT) with 6 months compulsory internship with minimum 50% aggregate.', 'Combined Paramedical Masters Entrance', 'Atal Bihari Vajpayee Medical University, Lucknow', 'Minimum age for admission is 17 years on or before 31st December of admission year. No upper age limit.', '20', 'BPT with 6 months internship', '80000'),
('PGDM-GN', '2 Years (4 Semesters)', 'Bachelor''s degree (3-year minimum) with minimum 50% (45% reserved).', 'CUET PG, CAT, MAT, GMAT Accepted. Entrance is not mandatory.', 'All India Council for Technical Education', 'No Restriction', '60', 'Any Graduate', '2,25,000'),
('PGDM-KT', '2 Years (4 Semesters)', 'Bachelor''s degree (3-year minimum) with minimum 50% (45% reserved).', 'CUET PG, CAT, MAT, GMAT Accepted. Entrance is not mandatory.', 'All India Council for Technical Education', 'No Restriction', '60', 'Any Graduate', '2,25,000')
) AS v(code, duration, eligibility, entrance_exam, affiliation, age_requirement, intake_seats, subjects, fee_first_year)
JOIN public.courses c ON c.code = v.code
ON CONFLICT (course_id) DO UPDATE SET
  duration=EXCLUDED.duration, eligibility=EXCLUDED.eligibility, entrance_exam=EXCLUDED.entrance_exam,
  affiliation=EXCLUDED.affiliation, age_requirement=EXCLUDED.age_requirement, intake_seats=EXCLUDED.intake_seats,
  subjects=EXCLUDED.subjects, fee_first_year=EXCLUDED.fee_first_year,
  source='admissions_curated_2026_27', verified_at=now(), updated_at=now();