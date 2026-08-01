-- Per-student ad-hoc fee heads (e.g. Transport payable monthly, Meal Addon
-- payable quarterly). Unlike the course/session fee_structure template, these
-- are applied to ONE student for chosen months at a chosen amount, at admission
-- time or later. The billing rows ARE the fee_ledger rows — no extra table.

-- Generic fee codes so the "Add fee head" dialog has something to pick.
-- Brand-specific transport/meal codes already exist; these are the fallbacks.
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('TRANSPORT',  'Transport Fee',      'transport', true),
  ('MEAL-ADDON', 'Meal Addon Charges', 'other',     true)
ON CONFLICT (code) DO NOTHING;

-- Insert ad-hoc fee_ledger rows for a single student from a client-built list
-- of {term, amount, due_date}. Idempotent on (student, fee_code, term) so
-- re-applying the same months is a no-op. Gated by the same permission that
-- guards fee-structure edits.
CREATE OR REPLACE FUNCTION public.add_student_fee_ledger_rows(
  _student_id  uuid,
  _fee_code_id uuid,
  _rows        jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fees';
  END IF;
  IF _student_id IS NULL OR _fee_code_id IS NULL THEN
    RAISE EXCEPTION 'Student and fee code are required';
  END IF;

  INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
  SELECT _student_id,
         _fee_code_id,
         (r->>'term')::text,
         (r->>'amount')::numeric,
         (r->>'due_date')::date,
         'due'
    FROM jsonb_array_elements(_rows) AS r
   WHERE (r->>'amount')::numeric > 0
     AND (r->>'term') IS NOT NULL
     AND (r->>'due_date') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.fee_ledger fl
        WHERE fl.student_id = _student_id
          AND fl.fee_code_id = _fee_code_id
          AND fl.term = (r->>'term')::text
     );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Keep concession/balance consistent with the rest of the ledger.
  PERFORM public.sync_fee_ledger_concessions(_student_id);
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_student_fee_ledger_rows(uuid, uuid, jsonb) TO authenticated;
