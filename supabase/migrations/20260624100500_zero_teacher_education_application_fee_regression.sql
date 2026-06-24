-- B.Ed and D.El.Ed application fee is explicitly zero. A frontend fallback bug
-- treated the configured 0 as missing and stored the default 1000 on new drafts.
-- Repair only unpaid all-teacher-education applications so mixed applications
-- such as B.Ed + LLB keep the non-zero fee for the other selected programme.

UPDATE public.applications
SET fee_amount = 0
WHERE payment_status IS DISTINCT FROM 'paid'
  AND COALESCE(fee_amount, 0) <> 0
  AND jsonb_typeof(COALESCE(course_selections, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(course_selections, '[]'::jsonb)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(course_selections, '[]'::jsonb)) AS sel
    WHERE NOT (
      sel->>'program_category' IN ('bed', 'deled')
      OR sel->>'course_name' ILIKE '%B.Ed%'
      OR sel->>'course_name' ILIKE '%BEd%'
      OR sel->>'course_name' ILIKE '%D.El.Ed%'
      OR sel->>'course_name' ILIKE '%DElEd%'
      OR sel->>'course_name' ILIKE '%Diploma%Elementary%'
    )
  );
