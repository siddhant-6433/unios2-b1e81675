-- Prior migration 20260521080736_zero_fee_bed_deled_pending_applications
-- zeroed the whole fee_amount on any pending application that touched B.Ed or
-- D.El.Ed, including applications that ALSO had a paid course (e.g. B.Ed + BPT).
-- That let applicants skip the BPT fee. The portal's calculateFee() only zeros
-- the B.Ed / D.El.Ed *contribution* and still charges other courses.
--
-- Restore fee_amount on pending mixed applications by summing per-selection
-- fees from FEE_MAP (src/components/apply/types.ts), with B.Ed / D.El.Ed
-- contributing 0. Apps where every selection is B.Ed / D.El.Ed stay at 0.

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
      ELSE 1000  -- undergraduate default
    END
  )
  FROM jsonb_array_elements(COALESCE(a.course_selections, '[]'::jsonb)) sel
), 0)
WHERE a.payment_status IS DISTINCT FROM 'paid'
  AND a.fee_amount = 0
  -- Only touch apps that have at least one selection which is NOT B.Ed / D.El.Ed
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
