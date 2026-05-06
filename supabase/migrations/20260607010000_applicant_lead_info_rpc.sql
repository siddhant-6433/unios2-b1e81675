-- Applicant-facing RPC to read their own lead row.
-- leads is staff-only via RLS; this SECURITY DEFINER function lets the anon
-- applicant portal fetch the fields it needs (stage, PAN, admission number)
-- without opening the entire table.

CREATE OR REPLACE FUNCTION public.get_applicant_lead_info(_lead_id uuid)
RETURNS TABLE (
  id               uuid,
  stage            text,
  session_id       text,
  pre_admission_no text,
  admission_no     text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.stage::text, l.session_id, l.pre_admission_no, l.admission_no
  FROM   public.leads l
  WHERE  l.id = _lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_lead_info(uuid) TO anon, authenticated;
