-- Remove the one-time full-payment waivers for B.Ed admissions.
--
-- B.Ed fee_structures carried a policy that granted:
--   lump_sum_first_year_waiver_pct = 5   (discount for paying the full first-year fee at once)
--   multi_year_waiver_pct          = 2.5 (discount for paying the full course fee at once)
--
-- Both are consumed by lead_fee_policy() -> lead_fee_status(), so zeroing them in
-- fee_structures.policy removes the discount everywhere (TokenFeePanel CTAs,
-- concession-on-ledger, receipts). Other policy keys (thresholds, min instalment,
-- window) are preserved.

UPDATE public.fee_structures fs
   SET policy = fs.policy
       || jsonb_build_object(
            'lump_sum_first_year_waiver_pct', 0,
            'multi_year_waiver_pct',          0
          )
  FROM public.courses c
 WHERE fs.course_id = c.id
   AND (c.name ILIKE '%B.Ed%' OR c.name ILIKE '%Bachelor of Education%');
