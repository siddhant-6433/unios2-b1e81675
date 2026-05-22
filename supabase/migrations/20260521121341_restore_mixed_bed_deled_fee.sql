UPDATE public.applications a
SET fee_amount = COALESCE((
  SELECT SUM(
    CASE
      WHEN sel->>'program_category' IN ('bed','deled')           THEN 0
      WHEN sel->>'course_name' ILIKE '%B.Ed%'                    THEN 0
      WHEN sel->>'course_name' ILIKE '%BEd%'                     THEN 0
      WHEN sel->>'course_name' ILIKE '%D.El.Ed%'                 THEN 0
      WHEN sel->>'course_name' ILIKE '%DElEd%'                   THEN 0
      WHEN sel->>'course_name' ILIKE '%Diploma%Elementary%'      THEN 0
      WHEN sel->>'program_category' = 'school'                   THEN 500
      WHEN sel->>'program_category' = 'mba_pgdm'                 THEN 1500
      WHEN sel->>'program_category' = 'postgraduate'             THEN 1500
      WHEN sel->>'program_category' = 'professional'             THEN 1000
      ELSE 1000
    END
  )
  FROM jsonb_array_elements(COALESCE(a.course_selections, '[]'::jsonb)) sel
), 0)
WHERE a.payment_status IS DISTINCT FROM 'paid'
  AND a.fee_amount = 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(a.course_selections, '[]'::jsonb)) sel
    WHERE sel->>'program_category' NOT IN ('bed','deled')
      AND sel->>'course_name' NOT ILIKE '%B.Ed%'
      AND sel->>'course_name' NOT ILIKE '%BEd%'
      AND sel->>'course_name' NOT ILIKE '%D.El.Ed%'
      AND sel->>'course_name' NOT ILIKE '%DElEd%'
      AND sel->>'course_name' NOT ILIKE '%Diploma%Elementary%'
  );
