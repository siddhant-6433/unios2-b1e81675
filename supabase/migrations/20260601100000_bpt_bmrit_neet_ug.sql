-- BPT and BMRIT had entrance_exam_required=true but no exam name set, so the
-- apply portal couldn't show anything. Switch to NEET UG as a *suggested*
-- (not required) exam — applicants who have a NEET UG score can declare it,
-- but it won't block the application for those who don't.

UPDATE public.eligibility_rules
SET entrance_exam_name = 'NEET UG',
    entrance_exam_required = false
WHERE course_id IN (
  SELECT id FROM public.courses
  WHERE name ILIKE '%Bachelor of Physiotherapy%'
     OR name ILIKE '%BPT%'
     OR name ILIKE '%BMRIT%'
     OR name ILIKE '%Radiology%Imaging%'
);
