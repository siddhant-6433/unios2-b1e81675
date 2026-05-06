-- Allow the anon applicant portal to read its own payment history.
-- lead_payments is staff-only via RLS; SECURITY DEFINER bypasses it.
CREATE OR REPLACE FUNCTION public.get_applicant_payments(_lead_id uuid)
RETURNS TABLE (
  id              uuid,
  receipt_no      text,
  type            text,
  amount          numeric,
  concession_amount numeric,
  payment_mode    text,
  transaction_ref text,
  status          text,
  payment_date    date,
  created_at      timestamptz,
  receipt_url     text,
  waiver_reason   text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lp.id, lp.receipt_no, lp.type::text, lp.amount, lp.concession_amount,
    lp.payment_mode::text, lp.transaction_ref, lp.status::text,
    lp.payment_date, lp.created_at, lp.receipt_url, lp.waiver_reason
  FROM public.lead_payments lp
  WHERE lp.lead_id = _lead_id
  ORDER BY lp.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_payments(uuid) TO anon, authenticated;
