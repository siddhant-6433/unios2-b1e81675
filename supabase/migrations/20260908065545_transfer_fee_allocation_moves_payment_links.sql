-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260908065545 name=transfer_fee_allocation_moves_payment_links
-- Git must keep this timestamp so `db push` matches remote history.
-- Pre-commit restamped the working copy to 20260908092530; production recorded
-- the original 20260908065545, which blocked later applies.

-- Transfer used to move fee_ledger.paid_amount only. The payment-link rows
-- that the Paid breakup (and provision_student_fees) treat as "this head is
-- settled" stayed on the source. After a Uniform → other-head transfer the
-- source still showed Paid ₹N against "No receipt no." and could not be
-- collected again, because cashiers tick rows with remaining balance.
--
-- Move (or unapply) fee_ledger_payments along with paid_amount, and rewrite
-- any lead_payments.allocations that named the source row so a later
-- provision cannot put the same rupees back.

CREATE OR REPLACE FUNCTION public._move_fee_ledger_payment_links(
  _from_id uuid,
  _to_id uuid,
  _amount numeric
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_left numeric := _amount;
  v_link RECORD;
  v_take numeric;
  v_refunded numeric;
  v_pays uuid[] := '{}';
BEGIN
  IF COALESCE(_amount, 0) <= 0 THEN RETURN v_pays; END IF;

  FOR v_link IN
    SELECT flp.id, flp.amount, flp.lead_payment_id, flp.concession_amount, flp.notes
      FROM public.fee_ledger_payments flp
     WHERE flp.fee_ledger_id = _from_id
     ORDER BY flp.applied_at NULLS LAST, flp.id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0.009;
    v_take := LEAST(v_link.amount, v_left);
    IF v_take <= 0.009 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_refunded
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = v_link.id
       AND fr.status <> 'rejected';

    IF v_link.lead_payment_id IS NOT NULL THEN
      v_pays := array_append(v_pays, v_link.lead_payment_id);
    END IF;

    IF _to_id IS NOT NULL THEN
      -- Head → head. Prefer relocating the existing link so refund items keep
      -- pointing at the same collection. Split when only part of the link moves.
      IF v_take >= v_link.amount - 0.009 THEN
        UPDATE public.fee_ledger_payments
           SET fee_ledger_id = _to_id
         WHERE id = v_link.id;
      ELSE
        IF v_link.amount - v_take < v_refunded - 0.009 THEN
          RAISE EXCEPTION
            'Cannot reallocate ₹% of this receipt — ₹% is already on a refund against it',
            v_take, v_refunded;
        END IF;
        UPDATE public.fee_ledger_payments
           SET amount = amount - v_take
         WHERE id = v_link.id;
        INSERT INTO public.fee_ledger_payments
          (fee_ledger_id, lead_payment_id, amount, concession_amount, notes)
        VALUES (_to_id, v_link.lead_payment_id, v_take, 0,
                COALESCE(v_link.notes, 'Reallocated from another head'));
      END IF;
    ELSE
      -- Head → credit: drop the link so the payment is unapplied. Keep any
      -- already-refunded remainder on the source so refund items stay valid.
      IF v_refunded > 0.009 THEN
        IF v_link.amount - v_take < v_refunded - 0.009 THEN
          RAISE EXCEPTION
            'Cannot unapply ₹% of this receipt — ₹% is already on a refund against it',
            v_take, v_refunded;
        END IF;
        UPDATE public.fee_ledger_payments
           SET amount = amount - v_take
         WHERE id = v_link.id;
      ELSE
        IF v_take >= v_link.amount - 0.009 THEN
          DELETE FROM public.fee_ledger_payments WHERE id = v_link.id;
        ELSE
          UPDATE public.fee_ledger_payments
             SET amount = amount - v_take
           WHERE id = v_link.id;
        END IF;
      END IF;
    END IF;

    v_left := v_left - v_take;
  END LOOP;

  RETURN v_pays;
END;
$function$;

REVOKE ALL ON FUNCTION public._move_fee_ledger_payment_links(uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._move_fee_ledger_payment_links(uuid, uuid, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public._rewrite_payment_allocations_from_links(_payment_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_alloc jsonb;
  v_linked numeric;
BEGIN
  IF _payment_ids IS NULL THEN RETURN; END IF;
  FOREACH v_id IN ARRAY _payment_ids LOOP
    IF v_id IS NULL THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_linked
      FROM public.fee_ledger_payments WHERE lead_payment_id = v_id;

    UPDATE public.lead_payments
       SET applied_to_ledger = (v_linked >= amount - 0.009)
     WHERE id = v_id;

    -- Only rewrite a breakup that already existed. Inventing one would push
    -- legacy sweep payments onto the allocation path.
    IF EXISTS (
      SELECT 1 FROM public.lead_payments
       WHERE id = v_id AND allocations IS NOT NULL
    ) THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'fee_code_id', fl.fee_code_id,
            'fee_ledger_id', fl.id,
            'amount', x.amt,
            'label', fc.name
          ) ORDER BY fl.due_date NULLS LAST, fl.id
        ),
        '[]'::jsonb
      ) INTO v_alloc
        FROM (
          SELECT flp.fee_ledger_id, SUM(flp.amount) AS amt
            FROM public.fee_ledger_payments flp
           WHERE flp.lead_payment_id = v_id
           GROUP BY flp.fee_ledger_id
        ) x
        JOIN public.fee_ledger fl ON fl.id = x.fee_ledger_id
        JOIN public.fee_codes fc ON fc.id = fl.fee_code_id;

      UPDATE public.lead_payments SET allocations = v_alloc WHERE id = v_id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public._rewrite_payment_allocations_from_links(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rewrite_payment_allocations_from_links(uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.transfer_fee_allocation(
  _from_fee_ledger_id uuid,
  _to_fee_ledger_id   uuid,
  _amount             numeric,
  _reason             text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text;
  v_from    RECORD;
  v_to      RECORD;
  v_to_code text;
  v_to_term text;
  v_to_paid numeric;
  v_student uuid;
  v_apply_to numeric := 0;
  v_credit numeric := 0;
  v_pays uuid[] := '{}';
  v_more uuid[];
BEGIN
  IF NOT public.can_reallocate_fee(v_actor) THEN
    RAISE EXCEPTION 'Not authorized to reallocate fees';
  END IF;
  IF COALESCE(NULLIF(btrim(_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to reallocate fees';
  END IF;
  IF COALESCE(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF _from_fee_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Source head required (use apply_student_credit to post credit onto a head)';
  END IF;

  SELECT fl.*, fc.code AS fee_code INTO v_from
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.id = _from_fee_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source head not found'; END IF;
  v_student := v_from.student_id;

  IF v_from.paid_amount < _amount THEN
    RAISE EXCEPTION 'Source head has only % paid; cannot move %', v_from.paid_amount, _amount;
  END IF;

  IF _to_fee_ledger_id IS NOT NULL THEN
    SELECT fl.*, fc.code AS fee_code INTO v_to
      FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.id = _to_fee_ledger_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Target head not found'; END IF;
    IF v_to.student_id <> v_student THEN RAISE EXCEPTION 'Source and target heads belong to different students'; END IF;
    IF _to_fee_ledger_id = _from_fee_ledger_id THEN
      RAISE EXCEPTION 'Source and target heads must be different';
    END IF;
    v_to_code := v_to.fee_code; v_to_term := v_to.term; v_to_paid := v_to.paid_amount;
    v_apply_to := LEAST(_amount, GREATEST(0, v_to.total_amount - v_to.concession - v_to.paid_amount));
  END IF;
  v_credit := _amount - v_apply_to;

  -- Relocate the receipt links before mutating paid_amount so a later
  -- provision cannot see an open source head still named by the payment.
  IF v_apply_to > 0 THEN
    v_pays := public._move_fee_ledger_payment_links(_from_fee_ledger_id, _to_fee_ledger_id, v_apply_to);
  END IF;
  IF v_credit > 0 THEN
    v_more := public._move_fee_ledger_payment_links(_from_fee_ledger_id, NULL, v_credit);
    v_pays := v_pays || v_more;
  END IF;
  PERFORM public._rewrite_payment_allocations_from_links(v_pays);

  UPDATE public.fee_ledger
     SET paid_amount = paid_amount - _amount,
         status = CASE WHEN (total_amount - concession - (paid_amount - _amount)) <= 0 THEN 'paid' ELSE 'due' END,
         updated_at = now()
   WHERE id = _from_fee_ledger_id;

  IF _to_fee_ledger_id IS NOT NULL AND v_apply_to > 0 THEN
    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_apply_to,
           status = CASE WHEN (total_amount - concession - (paid_amount + v_apply_to)) <= 0 THEN 'paid'
                         WHEN status = 'overdue' THEN 'overdue' ELSE 'due' END,
           updated_at = now()
     WHERE id = _to_fee_ledger_id;
  END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;

  INSERT INTO public.fee_ledger_reallocation_audit
    (student_id, action, from_fee_ledger_id, to_fee_ledger_id, from_fee_code, from_term,
     to_fee_code, to_term, amount, reason, actor_user_id, actor_role, before_json, after_json)
  VALUES (v_student,
     CASE WHEN _to_fee_ledger_id IS NULL THEN 'unapply_to_credit' ELSE 'transfer' END,
     _from_fee_ledger_id, _to_fee_ledger_id, v_from.fee_code, v_from.term, v_to_code, v_to_term,
     _amount, btrim(_reason), v_actor, v_role,
     jsonb_build_object('from_paid', v_from.paid_amount, 'to_paid', v_to_paid),
     jsonb_build_object('from_paid', v_from.paid_amount - _amount,
                        'to_paid', COALESCE(v_to_paid, 0) + v_apply_to,
                        'to_credit_overflow', v_credit));

  RETURN jsonb_build_object('moved', _amount, 'to_head', v_apply_to, 'to_credit', v_credit);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.transfer_fee_allocation(uuid, uuid, numeric, text) TO authenticated, service_role;

-- If paid_amount falls and the link rows are left behind, the Paid breakup still
-- shows a payment (often with no receipt). Trim the unreimbursed excess.
-- Refunded portions of a link are left in place so fee_refund_items stay valid.
CREATE OR REPLACE FUNCTION public.tg_trim_fee_ledger_payment_links_on_unpay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_linked numeric;
  v_refunded numeric;
  v_excess numeric;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.paid_amount >= OLD.paid_amount - 0.009 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(flp.amount), 0) INTO v_linked
    FROM public.fee_ledger_payments flp WHERE flp.fee_ledger_id = NEW.id;
  SELECT COALESCE(SUM(fri.amount), 0) INTO v_refunded
    FROM public.fee_refund_items fri
    JOIN public.fee_refunds fr ON fr.id = fri.refund_id
    JOIN public.fee_ledger_payments flp ON flp.id = fri.fee_ledger_payment_id
   WHERE flp.fee_ledger_id = NEW.id AND fr.status <> 'rejected';
  v_excess := v_linked - COALESCE(NEW.paid_amount, 0) - v_refunded;
  IF v_excess > 0.009 THEN
    PERFORM public._rewrite_payment_allocations_from_links(
      public._move_fee_ledger_payment_links(NEW.id, NULL, v_excess)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_trim_fee_ledger_payment_links_on_unpay ON public.fee_ledger;
CREATE TRIGGER trg_trim_fee_ledger_payment_links_on_unpay
AFTER UPDATE OF paid_amount ON public.fee_ledger
FOR EACH ROW
WHEN (NEW.paid_amount IS DISTINCT FROM OLD.paid_amount)
EXECUTE FUNCTION public.tg_trim_fee_ledger_payment_links_on_unpay();

-- Auto Apply Credit must not put unallocated money back onto Uniform: that is
-- the bounce-back after a Uniform → credit transfer (Uniform is often the
-- next-earliest unpaid head). Explicitly picking Uniform still works.
CREATE OR REPLACE FUNCTION public.apply_student_credit(
  _id uuid, _fee_ledger_id uuid DEFAULT NULL, _amount numeric DEFAULT NULL,
  _reason text DEFAULT NULL, _source_payment_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_student uuid; v_form uuid; v_credit numeric; v_budget numeric;
  v_applied numeric := 0; v_row RECORD; v_apply numeric; v_before numeric;
  v_actor uuid := auth.uid(); v_role text;
BEGIN
  SELECT s.id, s.lead_id INTO v_student, v_lead FROM public.students s WHERE s.id = _id OR s.lead_id = _id LIMIT 1;
  IF v_student IS NULL THEN RETURN jsonb_build_object('error', 'no student for id', 'applied', 0); END IF;
  SELECT id INTO v_form FROM public.fee_codes WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;
  PERFORM 1 FROM public.fee_ledger WHERE student_id = v_student FOR UPDATE;
  v_credit := (public.student_fee_credit_balance(COALESCE(v_lead, v_student)) ->> 'general_credit')::numeric;
  v_budget := LEAST(COALESCE(_amount, v_credit), v_credit);
  IF COALESCE(v_budget,0) <= 0 THEN
    RETURN jsonb_build_object('applied', 0, 'available_credit', COALESCE(v_credit,0), 'note', 'no credit available'); END IF;
  FOR v_row IN
    SELECT fl.id, fl.total_amount, fl.concession, fl.paid_amount, fl.due_date, fl.status, fc.code, fl.term
      FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_student AND fl.fee_code_id IS DISTINCT FROM v_form
       AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
       AND (_fee_ledger_id IS NULL OR fl.id = _fee_ledger_id)
       AND (
         _fee_ledger_id IS NOT NULL
         OR (
           UPPER(fc.code) IS DISTINCT FROM 'UNIFORM'
           AND fl.term NOT ILIKE 'uniform%'
         )
       )
     ORDER BY
       CASE WHEN UPPER(fc.code) LIKE '%SEC' THEN 1 WHEN fl.term = 'admission' THEN 0 ELSE 2 END,
       fl.due_date NULLS LAST, fl.term, fc.code, fl.id
  LOOP
    EXIT WHEN v_budget <= 0;
    v_apply := LEAST(v_budget, v_row.total_amount - v_row.concession - v_row.paid_amount);
    IF v_apply <= 0 THEN CONTINUE; END IF;
    v_before := v_row.paid_amount;
    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_apply,
           status = CASE WHEN (total_amount - concession - (paid_amount + v_apply)) <= 0 THEN 'paid'
                         WHEN status = 'overdue' THEN 'overdue' ELSE 'due' END,
           updated_at = now()
     WHERE id = v_row.id;
    IF _source_payment_id IS NOT NULL THEN
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, applied_at)
      VALUES (v_row.id, _source_payment_id, v_apply, now());
    END IF;
    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, to_fee_ledger_id, to_fee_code, to_term, amount, reason,
       actor_user_id, actor_role, before_json, after_json)
    VALUES (v_student, 'apply_credit', v_row.id, v_row.code, v_row.term, v_apply,
       COALESCE(NULLIF(btrim(_reason), ''), 'Credit applied'), v_actor, v_role,
       jsonb_build_object('paid_amount', v_before), jsonb_build_object('paid_amount', v_before + v_apply));
    v_budget := v_budget - v_apply; v_applied := v_applied + v_apply;
  END LOOP;
  PERFORM public.fn_recompute_late_fees(v_student);
  RETURN jsonb_build_object('applied', v_applied,
    'remaining_credit', (public.student_fee_credit_balance(COALESCE(v_lead, v_student)) ->> 'general_credit')::numeric);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.apply_student_credit(uuid, uuid, numeric, text, uuid) TO authenticated, service_role;

-- Existing students whose paid_amount already dropped but links were left behind.
DO $trim$
DECLARE
  r RECORD;
  v_refunded numeric;
  v_excess numeric;
BEGIN
  FOR r IN
    SELECT fl.id, fl.paid_amount, l.linked
      FROM public.fee_ledger fl
      JOIN LATERAL (
        SELECT COALESCE(SUM(flp.amount), 0) AS linked
          FROM public.fee_ledger_payments flp
         WHERE flp.fee_ledger_id = fl.id
      ) l ON true
     WHERE l.linked > fl.paid_amount + 0.009
  LOOP
    SELECT COALESCE(SUM(fri.amount), 0) INTO v_refunded
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
      JOIN public.fee_ledger_payments flp ON flp.id = fri.fee_ledger_payment_id
     WHERE flp.fee_ledger_id = r.id AND fr.status <> 'rejected';
    v_excess := r.linked - r.paid_amount - v_refunded;
    IF v_excess > 0.009 THEN
      PERFORM public._rewrite_payment_allocations_from_links(
        public._move_fee_ledger_payment_links(r.id, NULL, v_excess)
      );
    END IF;
  END LOOP;
END;
$trim$;

-- Pawan Yadav (AN-283F4F18): Uniform still shows Paid ₹6,000 against a link
-- with no receipt after a transfer. Clear the head so it can be collected,
-- then post the freed credit onto academic dues (not back onto Uniform).
DO $pawan$
DECLARE
  v_stu uuid;
  v_row RECORD;
  v_cleared numeric := 0;
  v_result jsonb;
BEGIN
  SELECT s.id INTO v_stu
    FROM public.students s
   WHERE s.deleted_at IS NULL
     AND replace(upper(COALESCE(s.admission_no, '')), ' ', '') = 'AN-283F4F18'
   LIMIT 1;
  IF v_stu IS NULL THEN
    RAISE NOTICE '[repair] AN-283F4F18 not found — skipped';
    RETURN;
  END IF;

  PERFORM 1 FROM public.fee_ledger WHERE student_id = v_stu FOR UPDATE;

  FOR v_row IN
    SELECT fl.id, fl.paid_amount, fl.due_date
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_stu
       AND (UPPER(fc.code) = 'UNIFORM' OR fl.term ILIKE 'uniform%')
       AND fl.paid_amount > 0.009
  LOOP
    UPDATE public.fee_ledger
       SET paid_amount = 0,
           status = CASE WHEN v_row.due_date IS NOT NULL AND v_row.due_date < CURRENT_DATE
                         THEN 'overdue' ELSE 'due' END,
           updated_at = now()
     WHERE id = v_row.id;
    v_cleared := v_cleared + v_row.paid_amount;
    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, from_fee_ledger_id, from_fee_code, from_term, amount, reason,
       actor_role, before_json, after_json)
    SELECT v_stu, 'unapply_to_credit', v_row.id, fc.code, fl.term, v_row.paid_amount,
           'Repair: Uniform left false-paid after transfer (AN-283F4F18)',
           'migration',
           jsonb_build_object('paid_amount', v_row.paid_amount),
           jsonb_build_object('paid_amount', 0)
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.id = v_row.id;
  END LOOP;

  IF v_cleared > 0.009 THEN
    v_result := public.apply_student_credit(
      v_stu, NULL, v_cleared,
      'Repair: apply credit unapplied from Uniform (AN-283F4F18)',
      NULL
    );
    RAISE NOTICE '[repair] AN-283F4F18 cleared ₹% from Uniform; apply_credit %',
      v_cleared, v_result;
  ELSE
    RAISE NOTICE '[repair] AN-283F4F18 Uniform already unpaid — skipped';
  END IF;
END;
$pawan$;
