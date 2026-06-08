-- Bank-remittance details printed on education-loan support letters.
-- These defaults can be updated later through _app_config without changing
-- the PDF generator.

INSERT INTO public._app_config (key, value) VALUES
  ('loan_letter_bank_beneficiary_name', 'NIMT B. SCHOOL''S FOUNDATION'),
  ('loan_letter_bank_name',             'IDFC BANK'),
  ('loan_letter_bank_account_no',       '10118454426'),
  ('loan_letter_bank_ifsc',             'IDFB0020154'),
  ('loan_letter_bank_branch',           'Alpha 1, Greater Noida'),
  ('loan_letter_bank_upi_id',           '-')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

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
  SELECT jsonb_object_agg(key, value) INTO v_result
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
