-- B.Ed and D.El.Ed applications carry a zero application fee. The portal already
-- prices them at 0 via FEE_MAP (src/components/apply/types.ts), but rows created
-- before that pricing was in effect still carry a non-zero fee_amount. Zero them
-- out on any application that has not yet paid.

UPDATE public.applications
SET fee_amount = 0
WHERE payment_status IS DISTINCT FROM 'paid'
  AND fee_amount <> 0
  AND (
    program_category IN ('bed', 'deled')
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(course_selections, '[]'::jsonb)) AS sel
      WHERE sel->>'program_category' IN ('bed', 'deled')
         OR sel->>'course_name' ILIKE '%B.Ed%'
         OR sel->>'course_name' ILIKE '%BEd%'
         OR sel->>'course_name' ILIKE '%D.El.Ed%'
         OR sel->>'course_name' ILIKE '%DElEd%'
         OR sel->>'course_name' ILIKE '%Diploma%Elementary%'
    )
  );
