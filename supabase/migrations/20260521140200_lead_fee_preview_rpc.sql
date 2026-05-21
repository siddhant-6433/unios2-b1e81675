-- ====================================================================
-- lead_fee_preview(_lead_id) — what the Fee Ledger WILL look like once
-- the candidate is pre-admitted. Returns one row per fee_structure_item
-- for the lead's resolved fee_structure (course + session, campus-aware),
-- in the same shape as the fee_ledger rows that provision_student_fees
-- would synthesise at PAN issuance.
--
-- Read-only — never writes to fee_ledger. Surfaces a "preview ledger"
-- in the candidate detail card so finance can validate the breakdown
-- before the candidate crosses the PAN threshold.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.lead_fee_preview(_lead_id uuid)
RETURNS TABLE (
  fee_code_id   uuid,
  fee_code_code text,
  fee_code_name text,
  term          text,
  total_amount  numeric,
  due_date      date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fs_id         uuid := public.lead_fee_structure_id(_lead_id);
  v_session_start date;
BEGIN
  IF v_fs_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(s.start_date, current_date) INTO v_session_start
    FROM public.leads l
    LEFT JOIN public.admission_sessions s ON s.id = l.session_id
   WHERE l.id = _lead_id;

  RETURN QUERY
  SELECT fsi.fee_code_id,
         fc.code,
         fc.name,
         fsi.term,
         fsi.amount,
         CASE
           WHEN fsi.term ~ '^year_[1-9]$'
             THEN (v_session_start
                   + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                   + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
           ELSE v_session_start
         END AS due_date
    FROM public.fee_structure_items fsi
    JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
   WHERE fsi.fee_structure_id = v_fs_id
   ORDER BY fsi.term, fc.code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_fee_preview TO authenticated, service_role;
