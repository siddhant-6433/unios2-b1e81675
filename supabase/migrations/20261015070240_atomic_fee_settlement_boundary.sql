-- atomic fee settlement boundary

-- Internal allocation primitive used by create_and_apply_fee_payment and by
-- repair flows. Receipt, allocation links, and ledger balances share a transaction.
CREATE OR REPLACE FUNCTION public.apply_fee_payment_allocations(
  _lead_payment_id uuid,
  _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payment public.lead_payments%ROWTYPE;
  v_allocation record;
  v_row public.fee_ledger%ROWTYPE;
  v_student_id uuid;
  v_total numeric := 0;
  v_concession_total numeric := 0;
  v_existing numeric := 0;
  v_existing_concession numeric := 0;
  v_rows int := 0;
  v_applied int := 0;
BEGIN
  IF _lead_payment_id IS NULL OR jsonb_typeof(_allocations) <> 'array' THEN
    RAISE EXCEPTION 'A payment id and allocation array are required' USING ERRCODE = '22023';
  END IF;

  -- Serialize competing uses of this receipt before reading its allocation total.
  SELECT * INTO v_payment
    FROM public.lead_payments
   WHERE id = _lead_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % was not found', _lead_payment_id USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Payment % is not pending or confirmed', _lead_payment_id USING ERRCODE = '23514';
  END IF;

  v_student_id := v_payment.student_id;
  IF v_student_id IS NULL AND v_payment.lead_id IS NOT NULL THEN
    SELECT id INTO v_student_id FROM public.students WHERE lead_id = v_payment.lead_id LIMIT 1;
  END IF;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Payment % is not linked to a student', _lead_payment_id USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('student:' || v_student_id::text, 1));

  SELECT * INTO v_payment
    FROM public.lead_payments
   WHERE id = _lead_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % was not found', _lead_payment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(concession_amount), 0)
    INTO v_existing, v_existing_concession
    FROM public.fee_ledger_payments
   WHERE lead_payment_id = _lead_payment_id;

  FOR v_allocation IN
    SELECT fee_ledger_id,
           SUM(amount)::numeric AS amount,
           COALESCE(SUM(concession_amount), 0)::numeric AS concession_amount,
           MAX(notes) AS notes
      FROM jsonb_to_recordset(_allocations) AS x(
        fee_ledger_id uuid,
        amount numeric,
        concession_amount numeric,
        notes text
      )
     GROUP BY fee_ledger_id
     ORDER BY fee_ledger_id
  LOOP
    IF v_allocation.fee_ledger_id IS NULL
       OR v_allocation.amount IS NULL
       OR v_allocation.amount < 0
       OR v_allocation.concession_amount < 0
       OR v_allocation.amount + v_allocation.concession_amount <= 0 THEN
      RAISE EXCEPTION 'Invalid allocation for payment %', _lead_payment_id USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_row
      FROM public.fee_ledger
     WHERE id = v_allocation.fee_ledger_id
       AND student_id = v_student_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ledger row % does not belong to payment student', v_allocation.fee_ledger_id
        USING ERRCODE = '23514';
    END IF;

    IF v_row.total_amount - v_row.paid_amount - v_row.concession
       < v_allocation.amount + v_allocation.concession_amount - 0.009 THEN
      RAISE EXCEPTION 'Allocation exceeds remaining balance for ledger row %', v_row.id
        USING ERRCODE = '23514';
    END IF;

    v_total := v_total + v_allocation.amount;
    v_concession_total := v_concession_total + v_allocation.concession_amount;
    v_rows := v_rows + 1;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_allocation.amount,
           concession = concession + v_allocation.concession_amount,
           status = CASE
             WHEN paid_amount + v_allocation.amount + concession + v_allocation.concession_amount
                  >= total_amount - 0.009 THEN 'paid'
             WHEN due_date < current_date THEN 'overdue'
             ELSE 'due'
           END,
           updated_at = now()
     WHERE id = v_row.id;

    INSERT INTO public.fee_ledger_payments (
      fee_ledger_id, lead_payment_id, amount, concession_amount, notes
    ) VALUES (
      v_row.id, _lead_payment_id, v_allocation.amount,
      v_allocation.concession_amount, v_allocation.notes
    );
    v_applied := v_applied + 1;
  END LOOP;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'At least one positive ledger allocation is required' USING ERRCODE = '23514';
  END IF;
  IF v_existing + v_total > v_payment.amount + 0.009 THEN
    RAISE EXCEPTION 'Payment % would be over-applied: already %, adding %, receipt amount %',
      _lead_payment_id, v_existing, v_total, v_payment.amount USING ERRCODE = '23514';
  END IF;
  IF v_existing_concession + v_concession_total > COALESCE(v_payment.concession_amount, 0) + 0.009 THEN
    RAISE EXCEPTION 'Payment % would exceed its recorded concession amount', _lead_payment_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.lead_payments
     SET applied_to_ledger = (v_existing + v_total >= v_payment.amount - 0.009)
   WHERE id = _lead_payment_id;

  RETURN jsonb_build_object(
    'payment_id', _lead_payment_id,
    'allocations_applied', v_applied,
    'total_applied', v_total,
    'total_concession', v_concession_total,
    'complete', (v_existing + v_total >= v_payment.amount - 0.009)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_fee_payment_allocations(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fee_payment_allocations(uuid, jsonb) TO service_role;

-- Create the receipt and apply its ledger allocations atomically. The pending
-- row suppresses the confirmation trigger until links and balances are ready.
CREATE OR REPLACE FUNCTION public.create_and_apply_fee_payment(
  _payment jsonb,
  _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_ref text := NULLIF(btrim(_payment->>'transaction_ref'), '');
  v_gateway text := NULLIF(btrim(_payment->>'gateway'), '');
  v_amount numeric := COALESCE((_payment->>'amount')::numeric, 0);
  v_student_id uuid := NULLIF(_payment->>'student_id', '')::uuid;
  v_existing public.lead_payments%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_ref IS NULL OR v_gateway IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Gateway, transaction reference, and positive amount are required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_allocations) <> 'array' THEN
    RAISE EXCEPTION 'An allocation array is required' USING ERRCODE = '22023';
  END IF;

  -- Transaction refs are globally unique for gateway receipts in this system.
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway-ref:' || v_ref, 0));
  SELECT * INTO v_existing
    FROM public.lead_payments
   WHERE transaction_ref = v_ref
   ORDER BY created_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.amount <> v_amount OR COALESCE(v_existing.gateway, '') <> v_gateway THEN
      RAISE EXCEPTION 'Transaction reference % already belongs to a different receipt', v_ref
        USING ERRCODE = '23505';
    END IF;
    IF v_existing.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Transaction reference % is attached to a non-confirmed receipt', v_ref
        USING ERRCODE = '23514';
    END IF;
    IF v_student_id IS NOT NULL AND v_existing.student_id IS NOT NULL
       AND v_existing.student_id <> v_student_id THEN
      RAISE EXCEPTION 'Transaction reference % belongs to a different student', v_ref
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('payment_id', v_existing.id, 'already', true);
  END IF;

  INSERT INTO public.lead_payments (
    lead_id, student_id, type, amount, concession_amount, payment_mode,
    gateway, transaction_ref, status, applied_to_ledger, allocations, notes
  ) VALUES (
    NULLIF(_payment->>'lead_id', '')::uuid,
    v_student_id,
    COALESCE(NULLIF(_payment->>'type', ''), 'other'),
    v_amount,
    COALESCE((_payment->>'concession_amount')::numeric, 0),
    COALESCE(NULLIF(_payment->>'payment_mode', ''), 'gateway'),
    v_gateway,
    v_ref,
    'pending',
    false,
    _allocations,
    NULLIF(_payment->>'notes', '')
  ) RETURNING id INTO v_id;

  v_result := public.apply_fee_payment_allocations(v_id, _allocations);
  IF COALESCE((v_result->>'complete')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Payment % was not fully allocated to the ledger', v_ref USING ERRCODE = '23514';
  END IF;
  IF ABS(COALESCE((v_result->>'total_concession')::numeric, 0)
         - COALESCE((_payment->>'concession_amount')::numeric, 0)) > 0.009 THEN
    RAISE EXCEPTION 'Payment % concession does not match its ledger allocations', v_ref USING ERRCODE = '23514';
  END IF;
  UPDATE public.lead_payments
     SET status = 'confirmed',
         applied_to_ledger = true
   WHERE id = v_id;

  RETURN v_result || jsonb_build_object('payment_id', v_id, 'already', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_and_apply_fee_payment(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_and_apply_fee_payment(jsonb, jsonb) TO service_role;

-- Serialize trigger-driven provisioning by student, using the same lock key as
-- direct gateway settlement. This covers both new-ledger-row and confirmation
-- events, including lead-less students.
CREATE OR REPLACE FUNCTION public.tg_credit_payments_after_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r record;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  FOR r IN
    SELECT DISTINCT s.id AS student_id, s.lead_id
      FROM new_rows nr
      JOIN public.students s ON s.id = nr.student_id
     ORDER BY s.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('student:' || r.student_id::text, 1));
    IF r.lead_id IS NOT NULL THEN
      PERFORM public.provision_student_fees(r.lead_id);
    ELSE
      PERFORM public.provision_student_fees_for_student(r.student_id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_credit_payments_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  v_student_id := NEW.student_id;
  IF v_student_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_student_id FROM public.students WHERE lead_id = NEW.lead_id LIMIT 1;
  END IF;
  IF v_student_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('student:' || v_student_id::text, 1));
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
  ELSIF NEW.student_id IS NOT NULL THEN
    PERFORM public.provision_student_fees_for_student(NEW.student_id);
  END IF;
  IF v_student_id IS NOT NULL THEN
    PERFORM public.fn_recompute_late_fees(v_student_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- The provisioners are also callable as RPCs. Put the serialization boundary
-- inside the public entry points so a direct caller cannot bypass trigger locks.
ALTER FUNCTION public.provision_student_fees(uuid) RENAME TO provision_student_fees_unlocked;
REVOKE ALL ON FUNCTION public.provision_student_fees_unlocked(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.provision_student_fees(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('student:' || v_student_id::text, 1));
  RETURN public.provision_student_fees_unlocked(_lead_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.provision_student_fees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_student_fees(uuid) TO authenticated, service_role;

ALTER FUNCTION public.provision_student_fees_for_student(uuid) RENAME TO provision_student_fees_for_student_unlocked;
REVOKE ALL ON FUNCTION public.provision_student_fees_for_student_unlocked(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.provision_student_fees_for_student(_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF _student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('student:' || _student_id::text, 1));
  RETURN public.provision_student_fees_for_student_unlocked(_student_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.provision_student_fees_for_student(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_student_fees_for_student(uuid) TO authenticated, service_role;

ALTER FUNCTION public.reconcile_application_fee(uuid) RENAME TO reconcile_application_fee_unlocked;
REVOKE ALL ON FUNCTION public.reconcile_application_fee_unlocked(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reconcile_application_fee(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('student:' || v_student_id::text, 1));
  RETURN public.reconcile_application_fee_unlocked(_lead_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.reconcile_application_fee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_application_fee(uuid) TO authenticated, service_role;

-- The old guard checked the sum without locking the receipt. Two concurrent
-- inserts could both observe the same remaining amount and spend it twice.
CREATE OR REPLACE FUNCTION public.tg_guard_payment_over_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_payment numeric;
  v_applied numeric;
BEGIN
  SELECT amount INTO v_payment
    FROM public.lead_payments
   WHERE id = NEW.lead_payment_id
   FOR UPDATE;
  IF v_payment IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_applied
    FROM public.fee_ledger_payments
   WHERE lead_payment_id = NEW.lead_payment_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_applied + NEW.amount > v_payment + 0.009 THEN
    RAISE EXCEPTION 'Payment % is already applied for % of %; refusing another %',
      NEW.lead_payment_id, v_applied, v_payment, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Row-level reconciliation prevents a student's valid opening balance from
-- masking a different fee head whose paid amount has no receipt allocation.
CREATE OR REPLACE VIEW public.v_fee_ledger_allocation_reconciliation AS
SELECT fl.id AS fee_ledger_id,
       fl.student_id,
       s.name AS student_name,
       COALESCE(s.admission_no, s.pre_admission_no) AS student_no,
       fl.fee_code_id,
       fc.code AS fee_code,
       fl.term,
       fl.total_amount,
       fl.concession,
       fl.paid_amount,
       COALESCE(linked.amount, 0) AS linked_payment_amount,
       COALESCE(linked.concession_amount, 0) AS linked_concession_amount,
       fl.paid_amount - COALESCE(linked.amount, 0) AS unlinked_paid_amount,
       CASE
         WHEN COALESCE(linked.amount, 0) > fl.paid_amount + 0.009 THEN 'links_exceed_ledger_paid'
         WHEN fl.paid_amount > COALESCE(linked.amount, 0) + 0.009 THEN 'paid_amount_without_receipt_links'
         WHEN COALESCE(linked.concession_amount, 0) > fl.concession + 0.009 THEN 'links_exceed_concession'
         ELSE 'balanced'
       END AS issue
  FROM public.fee_ledger fl
  JOIN public.students s ON s.id = fl.student_id
  LEFT JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
  LEFT JOIN LATERAL (
    SELECT SUM(flp.amount) AS amount,
           SUM(flp.concession_amount) AS concession_amount
      FROM public.fee_ledger_payments flp
     WHERE flp.fee_ledger_id = fl.id
  ) linked ON TRUE
 WHERE s.deleted_at IS NULL;

REVOKE ALL ON public.v_fee_ledger_allocation_reconciliation FROM anon;
GRANT SELECT ON public.v_fee_ledger_allocation_reconciliation TO authenticated, service_role;
