-- Let a charge be grouped UNDER a named term (q2, year_1…) while still carrying
-- a custom due date — e.g. three IB-Meal instalments under Q2, due 01 Aug / 01
-- Sep / 01 Oct, instead of landing in "Other Charges" (adhoc) just to get a date.
--
-- Rule: the caller's due date wins when given; otherwise the term's own
-- collection date is inherited (bulk multi-term attach still passes NULL and so
-- keeps inheriting each quarter's native date). Dedup stays due-date-aware, so
-- several instalments on distinct dates under the same term are allowed.

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
    -- Caller's date wins; else inherit the term's own collection date; else today.
    IF v_term = 'adhoc' THEN
      v_due := COALESCE(_due_date, CURRENT_DATE);
    ELSE
      SELECT MIN(fl.due_date) INTO v_due
        FROM public.fee_ledger fl
       WHERE fl.student_id = _student_id AND fl.term = v_term;
      v_due := COALESCE(_due_date, v_due, CURRENT_DATE);
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
