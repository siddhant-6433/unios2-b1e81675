-- Keep GNM entrance metadata consistent across the public course row and the
-- canonical eligibility_rules row. The document review page used stale
-- courses.entrance_exam data while eligibility_rules already correctly named
-- UPGET.

UPDATE public.courses
   SET eligibility = '10+2 with English and min 40% marks. ANM registered also eligible. UPSMF approved.',
       entrance_exam = 'UP GNM Entrance Test (UPGET)',
       entrance_mandatory = true
 WHERE code = 'GNM-GN';

UPDATE public.eligibility_rules er
   SET class_12_min_marks = 40,
       requires_graduation = false,
       entrance_exam_name = 'UP GNM Entrance Test (UPGET)',
       entrance_exam_required = true,
       subject_prerequisites = ARRAY['English','Any Stream 10+2'],
       notes = '10+2 with English and min 40% marks. ANM registered also eligible. 5% relaxation SC/ST. Intake: 30.',
       updated_at = now()
  FROM public.courses c
 WHERE er.course_id = c.id
   AND c.code = 'GNM-GN';
