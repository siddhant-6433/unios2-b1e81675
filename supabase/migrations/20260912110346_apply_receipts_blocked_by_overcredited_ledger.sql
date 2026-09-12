-- Clamping an over-applied receipt (N1234 ₹1600 → ₹800) freed budget, but
-- did not re-run provision. Receipts collected while the ledger was
-- over-credited (N1237 ₹400 for Jun 2026) stayed applied_to_ledger=false
-- with budget 0, so they sat as unallocated credit and the ticked month
-- stayed overdue.
--
-- After any unapply, drain waiting student receipts onto the ledger.
-- Also do that once for receipts already stuck in this state.

CREATE OR REPLACE FUNCTION public._drain_unapplied_student_receipts(
  _student_id uuid,
  _lead_id    uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _lead_id IS NOT NULL THEN
    PERFORM public.provision_student_fees(_lead_id);
  ELSIF _student_id IS NOT NULL THEN
    PERFORM public.provision_student_fees_for_student(_student_id);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._drain_unapplied_student_receipts(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._drain_unapplied_student_receipts(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public._unapply_lead_payment_links(
  _payment_id uuid,
  _amount     numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay      public.lead_payments%ROWTYPE;
  v_left     numeric;
  v_link     RECORD;
  v_take     numeric;
  v_refunded numeric;
  v_free     numeric;
  v_student  uuid;
  v_unapplied numeric := 0;
  v_heads    jsonb := '{}'::jsonb;
  v_head_id  uuid;
  v_taken    numeric;
BEGIN
  IF _payment_id IS NULL THEN
    RAISE EXCEPTION 'Payment required';
  END IF;

  SELECT * INTO v_pay FROM public.lead_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % not found', _payment_id;
  END IF;

  v_left := COALESCE(_amount, 0);
  IF v_left <= 0.009 THEN
    RETURN jsonb_build_object('unapplied', 0, 'student_id', NULL);
  END IF;

  FOR v_link IN
    SELECT flp.id, flp.amount, flp.fee_ledger_id,
           fl.student_id, fl.due_date
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.lead_payment_id = _payment_id
     ORDER BY fl.due_date DESC NULLS LAST, flp.applied_at DESC NULLS LAST, flp.id DESC
     FOR UPDATE OF flp, fl
  LOOP
    EXIT WHEN v_left <= 0.009;
    v_student := COALESCE(v_student, v_link.student_id);

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_refunded
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = v_link.id
       AND fr.status <> 'rejected';

    v_free := v_link.amount - v_refunded;
    IF v_free <= 0.009 THEN CONTINUE; END IF;

    v_take := LEAST(v_free, v_left);
    IF v_take <= 0.009 THEN CONTINUE; END IF;

    IF v_refunded > 0.009 THEN
      UPDATE public.fee_ledger_payments
         SET amount = amount - v_take
       WHERE id = v_link.id;
    ELSIF v_take >= v_link.amount - 0.009 THEN
      DELETE FROM public.fee_ledger_payments WHERE id = v_link.id;
    ELSE
      UPDATE public.fee_ledger_payments
         SET amount = amount - v_take
       WHERE id = v_link.id;
    END IF;

    v_heads := jsonb_set(
      v_heads,
      ARRAY[v_link.fee_ledger_id::text],
      to_jsonb(COALESCE((v_heads ->> v_link.fee_ledger_id::text)::numeric, 0) + v_take)
    );

    v_left := v_left - v_take;
    v_unapplied := v_unapplied + v_take;
  END LOOP;

  IF v_left > 0.009 THEN
    RAISE EXCEPTION
      'Cannot unapply ₹% of this receipt — ₹% is already on a refund against it',
      COALESCE(_amount, 0), v_left;
  END IF;

  FOR v_head_id, v_taken IN
    SELECT key::uuid, (value #>> '{}')::numeric FROM jsonb_each(v_heads)
  LOOP
    UPDATE public.fee_ledger
       SET paid_amount = GREATEST(0, paid_amount - v_taken),
           status = CASE
             WHEN (total_amount - concession - GREATEST(0, paid_amount - v_taken)) <= 0 THEN 'paid'
             ELSE 'due'
           END,
           updated_at = now()
     WHERE id = v_head_id
     RETURNING student_id INTO v_student;
  END LOOP;

  PERFORM public._rewrite_payment_allocations_from_links(ARRAY[_payment_id]);

  UPDATE public.lead_payments lp
     SET applied_to_ledger = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id
           ) THEN true
           ELSE (
             SELECT COALESCE(SUM(flp.amount), 0) >= lp.amount - 0.009
               FROM public.fee_ledger_payments flp
              WHERE flp.lead_payment_id = lp.id
           )
         END,
         allocations = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id
           ) THEN '[]'::jsonb
           ELSE lp.allocations
         END
   WHERE lp.id = _payment_id;

  IF v_student IS NOT NULL THEN
    PERFORM public.fn_recompute_late_fees(v_student);
  END IF;

  -- Budget just increased. Apply receipts that were collected while the
  -- ledger was over-credited (row-targeted allocations, applied_to_ledger=false).
  PERFORM public._drain_unapplied_student_receipts(
    COALESCE(v_student, v_pay.student_id),
    v_pay.lead_id
  );

  RETURN jsonb_build_object(
    'unapplied', v_unapplied,
    'student_id', v_student
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._unapply_lead_payment_links(uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._unapply_lead_payment_links(uuid, numeric)
  TO service_role;

-- Receipts already stuck: confirmed, allocated to a ledger row, never linked.
DO $drain$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT lp.student_id, lp.lead_id, lp.receipt_no
      FROM public.lead_payments lp
     WHERE lp.status = 'confirmed'
       AND lp.applied_to_ledger = false
       AND lp.student_id IS NOT NULL
       AND lp.allocations IS NOT NULL
       AND jsonb_array_length(lp.allocations) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.fee_ledger_payments flp
          WHERE flp.lead_payment_id = lp.id
       )
  LOOP
    PERFORM public._drain_unapplied_student_receipts(r.student_id, r.lead_id);
    RAISE NOTICE '[repair] drained waiting receipts for % (student %)',
      COALESCE(r.receipt_no, r.student_id::text), r.student_id;
  END LOOP;
END;
$drain$;

NOTIFY pgrst, 'reload schema';
