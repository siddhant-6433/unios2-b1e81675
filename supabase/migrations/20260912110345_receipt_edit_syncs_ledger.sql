-- Editing a receipt used to rewrite lead_payments.amount only. The fee_ledger
-- rows and fee_ledger_payments links that the original amount had been applied
-- to were left in place, so a ₹1600 → ₹800 correction left two ₹800 heads
-- "paid" against an ₹800 receipt.
--
-- School (lead-less) receipts also made resend_payment_notification raise
-- "Payment not found" because it treated a NULL lead_id as a missing row,
-- which is why the correction notice failed after the amount saved.
--
-- Rules:
--   1. allocated-to-ledger may never exceed the receipt amount
--   2. changing the amount while it is still applied requires unassigning first
--      (UI lock); the RPCs still clamp excess LIFO if anyone bypasses the UI
--   3. deleting a receipt unapplies it first (ON DELETE SET NULL would otherwise
--      leave ghost "Paid / no receipt" links)
--   4. a one-shot repair clamps every existing over-applied receipt

------------------------------------------------------------------------
-- Internal: unapply THIS payment's links, newest heads first.
-- Never reuse _move_fee_ledger_payment_links — that is head-FIFO and would
-- peel a different receipt off the same month.
------------------------------------------------------------------------
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

  -- Empty breakup + applied=false would let provision mark the receipt applied
  -- without posting anything (or, if allocations were nulled, sweep earliest-due).
  -- Park a fully unapplied receipt as unallocated credit instead.
  UPDATE public.lead_payments lp
     SET applied_to_ledger = (
           SELECT COALESCE(SUM(flp.amount), 0) >= lp.amount - 0.009
             FROM public.fee_ledger_payments flp
            WHERE flp.lead_payment_id = lp.id
         ),
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

------------------------------------------------------------------------
-- Public: unassign a receipt from the ledger (all, or an excess amount).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unapply_lead_payment_from_ledger(
  _payment_id uuid,
  _reason     text,
  _amount     numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay      public.lead_payments%ROWTYPE;
  v_linked   numeric;
  v_need     numeric;
  v_result   jsonb;
  v_actor    uuid := auth.uid();
  v_role     text;
  v_student  uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_actor AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required to unassign a receipt from the ledger';
  END IF;

  SELECT * INTO v_pay FROM public.lead_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % not found', _payment_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_linked
    FROM public.fee_ledger_payments WHERE lead_payment_id = _payment_id;

  v_need := COALESCE(_amount, v_linked);
  IF v_need > v_linked + 0.009 THEN
    v_need := v_linked;
  END IF;
  IF v_need <= 0.009 THEN
    RETURN jsonb_build_object('unapplied', 0, 'linked', v_linked);
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);
  v_result := public._unapply_lead_payment_links(_payment_id, v_need);
  v_student := NULLIF(v_result->>'student_id', '')::uuid;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = v_actor
   ORDER BY (CASE WHEN role::text = 'super_admin' THEN 0 ELSE 1 END) LIMIT 1;

  IF v_student IS NOT NULL AND v_need > 0.009 THEN
    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, amount, reason, actor_user_id, actor_role, before_json, after_json)
    VALUES (
      v_student, 'unapply_to_credit', v_need, btrim(_reason), v_actor, v_role,
      jsonb_build_object('payment_id', _payment_id, 'receipt_no', v_pay.receipt_no,
                         'receipt_amount', v_pay.amount, 'linked_before', v_linked),
      jsonb_build_object('linked_after', GREATEST(0, v_linked - v_need))
    );
  END IF;

  RETURN v_result || jsonb_build_object('linked_before', v_linked);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unapply_lead_payment_from_ledger(uuid, text, numeric)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- Re-apply an unassigned receipt onto specific ledger rows.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_lead_payment_allocations(
  _payment_id  uuid,
  _allocations jsonb,
  _reason      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay     public.lead_payments%ROWTYPE;
  v_sum     numeric;
  v_alloc   jsonb;
  v_fl      uuid;
  v_amt     numeric;
  v_student uuid;
  v_row     public.fee_ledger%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required to reassign a receipt';
  END IF;

  SELECT * INTO v_pay FROM public.lead_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % not found', _payment_id;
  END IF;
  IF v_pay.status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed receipts can be assigned to the ledger';
  END IF;

  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array'
     OR jsonb_array_length(_allocations) = 0 THEN
    RAISE EXCEPTION 'Pick at least one fee head to assign this receipt to';
  END IF;

  v_student := v_pay.student_id;
  IF v_student IS NULL AND v_pay.lead_id IS NOT NULL THEN
    SELECT id INTO v_student FROM public.students WHERE lead_id = v_pay.lead_id
     ORDER BY created_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'No student ledger to assign this receipt onto';
  END IF;

  -- Drop whatever is still linked so provision cannot double-apply on top of
  -- leftover rows from a previous assignment.
  SELECT COALESCE(SUM(amount), 0) INTO v_sum
    FROM public.fee_ledger_payments WHERE lead_payment_id = _payment_id;
  IF v_sum > 0.009 THEN
    PERFORM public._unapply_lead_payment_links(_payment_id, v_sum);
    SELECT * INTO v_pay FROM public.lead_payments WHERE id = _payment_id;
  END IF;

  v_sum := 0;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_fl := NULLIF(v_alloc->>'fee_ledger_id', '')::uuid;
    v_amt := COALESCE((v_alloc->>'amount')::numeric, 0);
    IF v_fl IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'Each assignment needs a fee head and a positive amount';
    END IF;
    SELECT * INTO v_row FROM public.fee_ledger WHERE id = v_fl AND student_id = v_student;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fee head does not belong to this student';
    END IF;
    v_sum := v_sum + v_amt;
  END LOOP;

  IF v_sum > v_pay.amount + 0.009 THEN
    RAISE EXCEPTION 'Assigned ₹% exceeds the receipt of ₹%', v_sum, v_pay.amount;
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);

  UPDATE public.lead_payments
     SET allocations = _allocations,
         applied_to_ledger = false
   WHERE id = _payment_id;

  IF v_pay.lead_id IS NOT NULL THEN
    PERFORM public.provision_student_fees(v_pay.lead_id);
  ELSE
    PERFORM public.provision_student_fees_for_student(v_student);
  END IF;

  RETURN jsonb_build_object(
    'assigned', (
      SELECT COALESCE(SUM(amount), 0)
        FROM public.fee_ledger_payments
       WHERE lead_payment_id = _payment_id
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_lead_payment_allocations(uuid, jsonb, text)
  TO authenticated, service_role;

------------------------------------------------------------------------
-- edit_lead_payment: clamp ledger to the new amount (LIFO excess).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_lead_payment(
  _id              uuid,
  _amount          numeric,
  _payment_mode    text,
  _transaction_ref text,
  _payment_date    timestamptz,
  _notes           text,
  _reason          text
)
RETURNS public.lead_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.lead_payments;
  v_linked numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required for receipt edit';
  END IF;
  IF COALESCE(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);

  UPDATE public.lead_payments
     SET amount          = _amount,
         payment_mode    = _payment_mode,
         transaction_ref = _transaction_ref,
         payment_date    = _payment_date,
         notes           = _notes
   WHERE id = _id
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt % not found', _id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_linked
    FROM public.fee_ledger_payments WHERE lead_payment_id = _id;

  IF v_linked > _amount + 0.009 THEN
    PERFORM public._unapply_lead_payment_links(_id, v_linked - _amount);
  ELSE
    UPDATE public.lead_payments
       SET applied_to_ledger = (v_linked >= amount - 0.009)
     WHERE id = _id
     RETURNING * INTO v_row;
  END IF;

  SELECT * INTO v_row FROM public.lead_payments WHERE id = _id;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_lead_payment(uuid, numeric, text, text, timestamptz, text, text)
  TO authenticated;

------------------------------------------------------------------------
-- delete_lead_payment: unapply first so paid_amount cannot outlive the receipt.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_lead_payment(
  _id     uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required for receipt deletion';
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);

  SELECT COALESCE(SUM(amount), 0) INTO v_linked
    FROM public.fee_ledger_payments WHERE lead_payment_id = _id;
  IF v_linked > 0.009 THEN
    PERFORM public._unapply_lead_payment_links(_id, v_linked);
  END IF;

  DELETE FROM public.lead_payments WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_lead_payment(uuid, text) TO authenticated;

------------------------------------------------------------------------
-- Correction notices for school (lead-less) receipts.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_payment_notification(
  _payment_id uuid,
  _mode       text DEFAULT 'resend'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id    uuid;
  v_student_id uuid;
  v_type       text;
  v_event      text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  SELECT lead_id, student_id, type INTO v_lead_id, v_student_id, v_type
    FROM public.lead_payments
   WHERE id = _payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', _payment_id;
  END IF;

  IF _mode = 'correction' THEN
    UPDATE public.lead_payments SET receipt_url = NULL WHERE id = _payment_id;
    v_event := 'payment_corrected';
  ELSIF v_type = 'application_fee' THEN
    v_event := 'app_fee_paid';
  ELSE
    v_event := 'payment_received';
  END IF;

  -- Lead-less school receipts have no WhatsApp/email lead. Clearing receipt_url
  -- is enough for the client to regenerate the PDF; do not raise "not found".
  IF v_lead_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.fn_notify_event(
    v_event,
    v_lead_id,
    jsonb_build_object('payment_id', _payment_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resend_payment_notification(uuid, text) TO authenticated;

------------------------------------------------------------------------
-- School students: credit must count student_id receipts, not just lead_id.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_fee_credit_balance(_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH stu AS (
    SELECT s.id, s.lead_id
      FROM public.students s
     WHERE s.id = _id OR s.lead_id = _id
     LIMIT 1
  ),
  resolved AS (
    SELECT
      (SELECT id FROM stu) AS student_id,
      COALESCE((SELECT lead_id FROM stu), CASE WHEN NOT EXISTS (SELECT 1 FROM stu) THEN _id END) AS lead_id
  ),
  form AS (
    SELECT id FROM public.fee_codes
     WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
     ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1
  ),
  pay AS (
    SELECT
      COALESCE(SUM(lp.amount) FILTER (WHERE lp.type = 'application_fee'), 0)  AS appfee_paid,
      COALESCE(SUM(lp.amount) FILTER (WHERE lp.type <> 'application_fee'), 0) AS other_paid
    FROM public.lead_payments lp, resolved r
    WHERE lp.status = 'confirmed'
      AND (
        (r.lead_id IS NOT NULL AND lp.lead_id = r.lead_id)
        OR (r.student_id IS NOT NULL AND lp.student_id = r.student_id)
      )
  ),
  led AS (
    SELECT COALESCE(SUM(fl.paid_amount), 0) AS nonform_paid
    FROM public.fee_ledger fl, resolved r
    WHERE r.student_id IS NOT NULL
      AND fl.student_id = r.student_id
      AND fl.fee_code_id IS DISTINCT FROM (SELECT id FROM form)
  )
  SELECT jsonb_build_object(
    'application_fee_paid', (SELECT appfee_paid FROM pay),
    'general_credit',      GREATEST(0, (SELECT other_paid FROM pay) - COALESCE((SELECT nonform_paid FROM led), 0))
  );
$function$;

GRANT EXECUTE ON FUNCTION public.student_fee_credit_balance(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.student_fee_credit_balances
WITH (security_invoker = true) AS
WITH form AS (
  SELECT id FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1
)
SELECT
  s.id      AS student_id,
  s.lead_id AS lead_id,
  COALESCE(p.appfee_paid, 0) AS application_fee_paid,
  GREATEST(0, COALESCE(p.other_paid, 0) - COALESCE(l.nonform_paid, 0)) AS general_credit
FROM public.students s
LEFT JOIN LATERAL (
  SELECT
    SUM(amount) FILTER (WHERE type = 'application_fee')  AS appfee_paid,
    SUM(amount) FILTER (WHERE type <> 'application_fee') AS other_paid
  FROM public.lead_payments lp
  WHERE lp.status = 'confirmed'
    AND (
      lp.student_id = s.id
      OR (s.lead_id IS NOT NULL AND lp.lead_id = s.lead_id)
    )
) p ON true
LEFT JOIN LATERAL (
  SELECT SUM(fl.paid_amount) AS nonform_paid
  FROM public.fee_ledger fl
  WHERE fl.student_id = s.id
    AND fl.fee_code_id IS DISTINCT FROM (SELECT id FROM form)
) l ON true;

GRANT SELECT ON public.student_fee_credit_balances TO authenticated, service_role;

------------------------------------------------------------------------
-- Repair receipts that are already over-applied (the ₹1600-vs-₹800 case).
------------------------------------------------------------------------
DO $repair$
DECLARE
  r RECORD;
  v_excess numeric;
BEGIN
  FOR r IN
    SELECT lp.id, lp.amount, lp.receipt_no, COALESCE(x.linked, 0) AS linked
      FROM public.lead_payments lp
      JOIN LATERAL (
        SELECT SUM(flp.amount) AS linked
          FROM public.fee_ledger_payments flp
         WHERE flp.lead_payment_id = lp.id
      ) x ON true
     WHERE lp.status = 'confirmed'
       AND COALESCE(x.linked, 0) > lp.amount + 0.009
  LOOP
    v_excess := r.linked - r.amount;
    PERFORM public._unapply_lead_payment_links(r.id, v_excess);
    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, amount, reason, actor_role, before_json, after_json)
    SELECT fl.student_id, 'unapply_to_credit', v_excess,
           format('Repair: receipt %s was ₹%s but ₹%s stayed applied on the ledger',
                  COALESCE(r.receipt_no, r.id::text), r.amount, r.linked),
           'migration',
           jsonb_build_object('payment_id', r.id, 'linked_before', r.linked, 'receipt_amount', r.amount),
           jsonb_build_object('linked_after', r.amount)
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.lead_payment_id = r.id
     LIMIT 1;
    RAISE NOTICE '[repair] receipt % unapplied excess ₹%', COALESCE(r.receipt_no, r.id::text), v_excess;
  END LOOP;
END;
$repair$;

NOTIFY pgrst, 'reload schema';
