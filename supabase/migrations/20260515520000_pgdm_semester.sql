-- PGDM is a semester-based programme, not trimester. Flip the course type and
-- rename the fee plan label so course-info pages (eligibility, fee structure
-- etc) show the correct exam mode.

UPDATE public.courses
SET type = 'semester'
WHERE code IN ('PGDM-GN', 'PGDM-GZ', 'PGDM-KT')
   OR name ILIKE '%PGDM%'
   OR name ILIKE '%Post Graduate Diploma%Management%';

UPDATE public.fee_structures
SET metadata = jsonb_set(
  metadata,
  '{plan_name}',
  to_jsonb(REPLACE(metadata->>'plan_name', 'Trimester', 'Semester'))
)
WHERE metadata->>'plan_name' ILIKE '%Trimester%';
