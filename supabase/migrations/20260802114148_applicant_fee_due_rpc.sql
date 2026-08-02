-- Applicant-portal fee-due summary. After a candidate is admitted (a students
-- row + fee_ledger exist), the application portal shows a "Pay remaining course
-- fee" action. leads/students/fee_ledger are staff-only via RLS; SECURITY
-- DEFINER lets the applicant key read its own due summary. Mirrors the existing
-- get_applicant_* capability pattern (no auth.uid() check — the portal only
-- ever holds its own lead_id, resolved from application_id).
CREATE OR REPLACE FUNCTION public.get_applicant_fee_due(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student uuid;
  v_due numeric;
  v_heads jsonb;
BEGIN
  SELECT id INTO v_student FROM public.students WHERE lead_id = _lead_id LIMIT 1;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('student_id', NULL, 'due_total', 0, 'heads', '[]'::jsonb);
  END IF;

  SELECT COALESCE(SUM(fl.balance) FILTER (WHERE fl.status IN ('due','overdue')), 0)
    INTO v_due
    FROM public.fee_ledger fl
   WHERE fl.student_id = v_student;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fee_ledger_id', fl.id,
           'code', fc.code,
           'term', fl.term,
           'balance', fl.balance,
           'due_date', fl.due_date
         ) ORDER BY fl.due_date NULLS LAST, fl.term), '[]'::jsonb)
    INTO v_heads
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student
     AND fl.status IN ('due','overdue')
     AND fl.balance > 0;

  RETURN jsonb_build_object('student_id', v_student, 'due_total', v_due, 'heads', v_heads);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_fee_due(uuid) TO anon, authenticated;
