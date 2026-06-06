-- BPT/BMRIT 2026-27 admissions: operational UP rule is CAHET/Common
-- Allied & Healthcare Admission 2026 through ABVMU Lucknow. NEET UG is
-- exempt for this UP admission cycle.
--
-- BPT programme details follow the 09 Jan 2026 NCAHP/NTA letter:
-- Physiotherapy Professional, ISCO Code 2264, 5 years total
-- (4 years academic programme + 1 year internship), annual mode.
-- BMRIT uses the same 10+2 PCB/English eligibility pattern and
-- ISCO Code 3211.

UPDATE public.courses
SET duration_years = 5,
    type = 'annual',
    eligibility = '10+2 or equivalent with Physics, Chemistry, Biology (or Botany & Zoology) and English pass. Minimum 50% PCB aggregate; 40% for SC/ST/OBC-NCL/PwD.',
    entrance_exam = 'CAHET 2026 counselling by ABVMU Lucknow',
    entrance_mandatory = true,
    marketing_eligibility = '10+2 PCB with 50% aggregate (40% SC/ST/OBC-NCL/PwD), English pass. UP 2026-27 admission via ABVMU CAHET counselling.',
    course_summary = 'Bachelor of Physiotherapy (BPT) is a 5-year annual programme: 4 academic years plus 1 year compulsory internship. NCAHP category: Physiotherapy Professional, ISCO Code 2264.',
    highlights = (
      SELECT array_agg(DISTINCT h ORDER BY h)
      FROM unnest(COALESCE(highlights, ARRAY[]::text[]) || ARRAY[
        '5-year annual programme: 4 academic years + 1-year compulsory internship',
        'NCAHP Physiotherapy Professional category, ISCO Code 2264',
        'UP 2026-27 admissions via CAHET counselling by ABVMU Lucknow'
      ]) AS u(h)
    )
WHERE code = 'BPT-GN';

UPDATE public.courses
SET eligibility = '10+2 or equivalent with Physics, Chemistry, Biology and English pass. Minimum 50% PCB aggregate; 40% for SC/ST/OBC-NCL/PwD.',
    entrance_exam = 'CAHET 2026 counselling by ABVMU Lucknow',
    entrance_mandatory = true,
    marketing_eligibility = '10+2 PCB with 50% aggregate (40% SC/ST/OBC-NCL/PwD), English pass. UP 2026-27 admission via ABVMU CAHET counselling.',
    course_summary = 'B.Sc in Radiology & Imaging Technology (BMRIT) follows the same 10+2 PCB/English eligibility pattern for UP 2026-27 CAHET counselling. ISCO Code 3211.',
    highlights = (
      SELECT array_agg(DISTINCT h ORDER BY h)
      FROM unnest(COALESCE(highlights, ARRAY[]::text[]) || ARRAY[
        'ISCO Code 3211',
        'UP 2026-27 admissions via CAHET counselling by ABVMU Lucknow'
      ]) AS u(h)
    )
WHERE code = 'BMRIT-GN';

UPDATE public.eligibility_rules er
SET min_age = 17,
    class_12_min_marks = 50,
    graduation_min_marks = NULL,
    requires_graduation = false,
    entrance_exam_name = 'CAHET 2026 Registration',
    entrance_exam_required = true,
    subject_prerequisites = ARRAY['PCB (English Mandatory)'],
    notes = 'BPT: NCAHP Physiotherapy Professional, ISCO Code 2264. Programme duration: 5 years annual (4 academic years + 1 year compulsory internship). Eligibility: 10+2 PCB/Botany & Zoology with 50% aggregate, English pass; 40% for SC/ST/OBC-NCL/PwD. UP 2026-27 admission is through ABVMU CAHET counselling; NEET UG exempt this year. Intake: 60.',
    updated_at = now()
FROM public.courses c
WHERE er.course_id = c.id
  AND c.code = 'BPT-GN';

UPDATE public.eligibility_rules er
SET min_age = 17,
    class_12_min_marks = 50,
    graduation_min_marks = NULL,
    requires_graduation = false,
    entrance_exam_name = 'CAHET 2026 Registration',
    entrance_exam_required = true,
    subject_prerequisites = ARRAY['PCB (English Mandatory)'],
    notes = 'BMRIT: ISCO Code 3211. Eligibility: 10+2 PCB with 50% aggregate, English pass; 40% for SC/ST/OBC-NCL/PwD. UP 2026-27 admission is through ABVMU CAHET counselling; NEET UG exempt this year. Intake: 40.',
    updated_at = now()
FROM public.courses c
WHERE er.course_id = c.id
  AND c.code = 'BMRIT-GN';
