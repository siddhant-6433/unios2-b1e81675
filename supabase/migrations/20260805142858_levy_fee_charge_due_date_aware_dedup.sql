-- A recurring add-on billed MONTHLY (e.g. IB Meal ₹3,000/mo) needs several
-- unpaid copies inside one quarter, each due on its own month's date. The old
-- dedup keyed on (fee_code, term) alone, so the second copy was rejected with
-- "An unpaid … charge already exists on q2" even though its due date differed.
-- And the 'adhoc' one-off path inherited MIN(due_date) of the existing adhoc
-- rows, collapsing every instalment onto the first one's date.
--
-- Now:
--   * Due date is resolved BEFORE the dedup. A named term (q2, year_1…) still
--     inherits that term's collection date; an 'adhoc' one-off uses the caller's
--     chosen date instead of another adhoc row's.
--   * The dedup blocks only a TRUE duplicate — same head, same term, same due
--     date, still unpaid — so a genuine mis-click is caught but monthly
--     instalments on distinct dates go through.

CREATE OR REPLACE FUNCTION public.levy_fee_charge(
  _student_id uuid,
  _head_id    uuid,
  _due_date   date DEFAULT NULL,
  _note       text DEFAULT NULL,
  _terms      text[] DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_head    record;
  v_terms   text[];
  v_term    text;
  v_due     date;
  v_exists  uuid;
  v_id      uuid;
  v_ids     uuid[] := '{}';
BEGIN
  IF NOT public.can_collect_fee(auth.uid()) THEN
    RAISE EXCEPTION 'Only an accountant or super admin can levy a charge';
  END IF;

  SELECT ofh.*, fc.code INTO v_head
    FROM public.optional_fee_heads ofh
    JOIN public.fee_codes fc ON fc.id = ofh.fee_code_id
   WHERE ofh.id = _head_id AND ofh.is_active;
  IF v_head IS NULL THEN
    RAISE EXCEPTION 'Fee head not found or inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.available_fee_charges(_student_id, NULL) a WHERE a.id = _head_id
  ) THEN
    RAISE EXCEPTION 'This fee head is not enabled for this student';
  END IF;

  v_terms := CASE
    WHEN _terms IS NULL OR array_length(_terms, 1) IS NULL THEN ARRAY['adhoc']
    ELSE _terms
  END;

  FOREACH v_term IN ARRAY v_terms LOOP
    -- Resolve the due date first, so the dedup can key on it.
    -- A named term inherits its own collection date; an 'adhoc' one-off keeps
    -- the caller's date (its whole point is a date of its own).
    IF v_term = 'adhoc' THEN
      v_due := COALESCE(_due_date, CURRENT_DATE);
    ELSE
      SELECT MIN(fl.due_date) INTO v_due
        FROM public.fee_ledger fl
       WHERE fl.student_id = _student_id AND fl.term = v_term;
      v_due := COALESCE(v_due, _due_date, CURRENT_DATE);
    END IF;

    -- Block only a true duplicate: same head, same term, same due date, unpaid.
    SELECT fl.id INTO v_exists
      FROM public.fee_ledger fl
     WHERE fl.student_id = _student_id
       AND fl.fee_code_id = v_head.fee_code_id
       AND fl.term = v_term
       AND fl.due_date = v_due
       AND fl.balance > 0
     LIMIT 1;
    IF v_exists IS NOT NULL THEN
      RAISE EXCEPTION 'An unpaid % charge is already billed on % (due %). Pick a different due date for another instalment.',
        v_head.code, v_term, to_char(v_due, 'DD Mon');
    END IF;

    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    VALUES (_student_id, v_head.fee_code_id, v_term, v_head.amount, v_due, 'due')
    RETURNING id INTO v_id;

    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.levy_fee_charge(uuid, uuid, date, text, text[])
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
