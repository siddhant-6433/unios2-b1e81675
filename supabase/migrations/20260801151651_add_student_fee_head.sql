-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260801151651 name=add_student_fee_head applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Per-student ad-hoc fee heads. Backs main's "Add Fee Head" dialog.
INSERT INTO public.fee_codes (code, name, category, is_recurring) VALUES
  ('TRANSPORT',  'Transport Fee',      'transport', true),
  ('MEAL-ADDON', 'Meal Addon Charges', 'other',     true)
ON CONFLICT (code) DO NOTHING;

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

  PERFORM public.sync_fee_ledger_concessions(_student_id);
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_student_fee_ledger_rows(uuid, uuid, jsonb) TO authenticated;
