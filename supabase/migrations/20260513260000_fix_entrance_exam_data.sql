-- Fix entrance exam data for courses that require entrance exams
-- BSc Nursing requires NEET or state-level entrance exam

UPDATE public.courses SET
  entrance_exam = 'UP CPNET / NEET UG (state counselling)',
  entrance_mandatory = true
WHERE name ILIKE '%B.Sc%Nursing%';

-- BPT also requires entrance
UPDATE public.courses SET
  entrance_exam = 'UP CPAT / State Entrance Exam',
  entrance_mandatory = true
WHERE name ILIKE '%BPT%' OR name ILIKE '%Physiotherapy%';

-- BMRIT entrance
UPDATE public.courses SET
  entrance_exam = 'Merit-based (no entrance exam)',
  entrance_mandatory = false
WHERE name ILIKE '%BMRIT%' OR name ILIKE '%Radiology%';

-- Law courses: CLAT / University entrance
UPDATE public.courses SET
  entrance_exam = 'CLAT / University Entrance Test',
  entrance_mandatory = true
WHERE name ILIKE '%LLB%' OR name ILIKE '%B.A. LL.B%';

-- B.Ed entrance
UPDATE public.courses SET
  entrance_exam = 'UP B.Ed JEE / State Entrance',
  entrance_mandatory = true
WHERE name ILIKE '%B.Ed%';

-- Engineering
UPDATE public.courses SET
  entrance_exam = 'JEE Main / UPSEE',
  entrance_mandatory = true
WHERE name ILIKE '%B.Tech%';

-- MBA
UPDATE public.courses SET
  entrance_exam = 'CAT / MAT / CMAT / UPCET',
  entrance_mandatory = true
WHERE name ILIKE '%MBA%' OR name ILIKE '%Master of Business%';

-- MCA
UPDATE public.courses SET
  entrance_exam = 'NIMCET / UPCET',
  entrance_mandatory = true
WHERE name ILIKE '%MCA%';

-- GNM - no entrance
UPDATE public.courses SET
  entrance_exam = 'Merit-based admission (no entrance exam)',
  entrance_mandatory = false
WHERE name ILIKE '%GNM%';

-- School courses - no entrance
UPDATE public.courses SET
  entrance_exam = 'Interaction and age-appropriate assessment',
  entrance_mandatory = false
WHERE code LIKE 'BSAV-%' OR code LIKE 'BSA-%' OR code LIKE 'MIR-%';
