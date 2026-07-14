-- 20260619100000 redefined get_applicant_deadlines() from the stale live
-- version (20260618213500 had never reached production because of the
-- migration-history drift), which dropped the loan_letter_bank_* keys the
-- applicant loan-letter preview reads. This merges both intents: bank
-- details + the 10 June → 14 June automatic deadline rollover.

CREATE OR REPLACE FUNCTION public.get_applicant_deadlines()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN key = 'fee_submission_deadline'
        AND value::date <= DATE '2026-06-10'
        AND now() > '2026-06-10 23:59:59+05:30'::timestamptz
      THEN '2026-06-14'
      ELSE value
    END
  )
  INTO v_result
  FROM public._app_config
  WHERE key IN (
    'fee_submission_deadline',
    'full_course_payment_deadline',
    'loan_letter_bank_beneficiary_name',
    'loan_letter_bank_name',
    'loan_letter_bank_account_no',
    'loan_letter_bank_ifsc',
    'loan_letter_bank_branch',
    'loan_letter_bank_upi_id'
  );

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_deadlines() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
