-- BPT and BMRIT do not require an entrance exam — clear the entrance fields
-- so course detail pages on nimtweb match what we tell applicants.

UPDATE public.courses
SET entrance_exam = NULL,
    entrance_mandatory = FALSE
WHERE name ILIKE 'Bachelor of Physiotherapy%'
   OR name ILIKE '%BPT%'
   OR name ILIKE 'B.Sc%Medical Radiologic%Imaging Technology%'
   OR name ILIKE '%BMRIT%';
