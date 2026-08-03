-- ====================================================================
-- 1. A settled row can never read "overdue" again.
--
--    fn_mark_overdue_fees only ever sets 'overdue' WHERE balance > 0, and
--    nothing sets the row back once a later waiver or payment clears it.
--    So a security deposit fully covered by an offer waiver — total 20,000,
--    concession 20,000, balance 0 — sat on the ledger flagged Overdue with
--    nothing actually due. 4 rows in production are in that state.
--
--    Fixed at the row level rather than in the cron, so the correction is
--    immediate on every write path (payment, concession sync, transfer,
--    re-provision) instead of waiting for the 00:30 UTC sweep.
--
--    NOTE: fee_ledger.balance is a STORED generated column, which Postgres
--    computes AFTER before-triggers run. NEW.balance is therefore stale in
--    here — the outstanding amount has to be recomputed by hand.
--
-- 2. An ad-hoc charge can be attached to existing collection terms.
--
--    levy_fee_charge only ever wrote one row at term='adhoc' with its own
--    due date, so a recurring add-on (IB Meal Addon, transport) could not be
--    hung off the quarters it is actually billed with. It now takes a list of
--    terms and posts one row per term, inheriting each term's existing due
--    date from the student's own ledger so the charge lands on the same
--    collection date as the rest of that quarter.
--
--    The amount still comes from the catalog row — never from the caller.
-- ====================================================================

-- ────────── 1. status follows the money ───────────────────────────────
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
    -- Something re-opened the row (waiver reduced, payment reversed). Hand it
    -- back to the due/overdue cycle; fn_mark_overdue_fees re-ages it.
    NEW.status := 'due';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_ledger_settle_status ON public.fee_ledger;
CREATE TRIGGER trg_fee_ledger_settle_status
BEFORE INSERT OR UPDATE OF total_amount, concession, paid_amount, status ON public.fee_ledger
FOR EACH ROW EXECUTE FUNCTION public.fn_fee_ledger_settle_status();

-- Correct the rows already stuck this way.
UPDATE public.fee_ledger
   SET status = 'paid'
 WHERE (total_amount - concession - paid_amount) <= 0
   AND status <> 'paid';

-- ────────── 2. multi-term ad-hoc charges ──────────────────────────────
-- Signature changes (adds _terms), so replace rather than CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.levy_fee_charge(uuid, uuid, date, text);

CREATE OR REPLACE FUNCTION public.levy_fee_charge(
  _student_id uuid,
  _head_id    uuid,
  _due_date   date DEFAULT NULL,
  _note       text DEFAULT NULL,
  -- Existing collection terms to attach this charge to (q1, q2, year_1…).
  -- NULL/empty keeps the old behaviour: a single one-off 'adhoc' row.
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

  -- Scope re-check server-side: the client list is a convenience, not a gate.
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
    -- Don't stack a second unpaid copy of the same charge on the same term.
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

    -- Bill it on the same date the rest of that term is collected. Falls back
    -- to the caller's date, then today, for a term with no existing rows.
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

-- Terms this student is actually billed on, so the charge dialog can offer
-- real collection dates instead of a free-text due date.
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
