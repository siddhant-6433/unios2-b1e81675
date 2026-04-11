-- Backfill: copy real names from leads to applications where application
-- has 'Applicant' placeholder (handleStepNext was saving an empty {} object
-- so PersonalDetails changes never hit the DB — see ApplyPortal handleStepNext fix)

UPDATE public.applications a
SET full_name = l.name
FROM public.leads l
WHERE a.lead_id = l.id
  AND (a.full_name = 'Applicant' OR a.full_name IS NULL OR a.full_name = '')
  AND l.name IS NOT NULL
  AND l.name != 'Applicant'
  AND l.name != '';

-- And the reverse: lead name → application where application has real name
UPDATE public.leads l
SET name = a.full_name
FROM public.applications a
WHERE a.lead_id = l.id
  AND (l.name IS NULL OR l.name = 'Applicant' OR l.name = '')
  AND a.full_name IS NOT NULL
  AND a.full_name != 'Applicant'
  AND a.full_name != '';
