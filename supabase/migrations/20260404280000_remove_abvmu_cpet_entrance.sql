-- ABVMU CPET entrance exam has been removed for BMRIT and BPT for 2026-27 session.
-- These courses now have direct admission (no entrance mandatory).

UPDATE courses
SET entrance_mandatory = false,
    entrance_exam = NULL
WHERE name ILIKE '%radiology%'
   OR name ILIKE '%BMRIT%'
   OR name ILIKE '%BPT%'
   OR name ILIKE '%physiotherapy%';

-- Also update B.Sc Nursing (ABVMU CNET removed)
UPDATE courses
SET entrance_mandatory = false,
    entrance_exam = NULL
WHERE name ILIKE '%nursing%'
  AND name ILIKE '%b.sc%';
