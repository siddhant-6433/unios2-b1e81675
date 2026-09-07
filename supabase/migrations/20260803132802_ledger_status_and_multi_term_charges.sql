-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260803132802 name=ledger_status_and_multi_term_charges applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.fn_fee_ledger_settle_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_outstanding numeric;
BEGIN
  v_outstanding := COALESCE(NEW.total_amount, 0)
                 - COALESCE(NEW.concession, 0)
                 - COALESCE(NEW.paid_amount, 0);

  IF v_outstanding <= 0 THEN
    NEW.status := 'paid';
  ELSIF NEW.status = 'paid' THEN
    NEW.status := 'due';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_ledger_settle_status ON public.fee_ledger;
CREATE TRIGGER trg_fee_ledger_settle_status
BEFORE INSERT OR UPDATE OF total_amount, concession, paid_amount, status ON public.fee_ledger
FOR EACH ROW EXECUTE FUNCTION public.fn_fee_ledger_settle_status();

UPDATE public.fee_ledger
   SET status = 'paid'
 WHERE (total_amount - concession - paid_amount) <= 0
   AND status <> 'paid';

DROP FUNCTION IF EXISTS public.levy_fee_charge(uuid, uuid, date, text);

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
    SELECT fl.id INTO v_exists
      FROM public.fee_ledger fl
     WHERE fl.student_id = _student_id
       AND fl.fee_code_id = v_head.fee_code_id
       AND fl.term = v_term
       AND fl.balance > 0
     LIMIT 1;
    IF v_exists IS NOT NULL THEN
      RAISE EXCEPTION 'An unpaid % charge already exists on %', v_head.code, v_term;
    END IF;

    SELECT MIN(fl.due_date) INTO v_due
      FROM public.fee_ledger fl
     WHERE fl.student_id = _student_id AND fl.term = v_term;

    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    VALUES (_student_id, v_head.fee_code_id, v_term, v_head.amount,
            COALESCE(v_due, _due_date, CURRENT_DATE), 'due')
    RETURNING id INTO v_id;

    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.levy_fee_charge(uuid, uuid, date, text, text[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.student_fee_terms(_student_id uuid)
RETURNS TABLE (term text, due_date date, rows bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT fl.term, MIN(fl.due_date) AS due_date, COUNT(*) AS rows
    FROM public.fee_ledger fl
   WHERE fl.student_id = _student_id
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
   GROUP BY fl.term
   ORDER BY MIN(fl.due_date);
$$;

GRANT EXECUTE ON FUNCTION public.student_fee_terms(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
