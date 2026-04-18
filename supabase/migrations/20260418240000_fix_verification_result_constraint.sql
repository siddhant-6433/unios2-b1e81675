-- Fix: update verification_result constraint to include discrepancy_marks
ALTER TABLE public.alumni_verification_requests
  DROP CONSTRAINT IF EXISTS alumni_verification_requests_verification_result_check;

ALTER TABLE public.alumni_verification_requests
  ADD CONSTRAINT alumni_verification_requests_verification_result_check
  CHECK (verification_result IN ('confirmed', 'not_found', 'discrepancy', 'discrepancy_marks'));

-- Also fix: all results should set status to verified/rejected properly
-- "confirmed" → verified, "discrepancy_marks" → rejected, "not_found" → rejected
