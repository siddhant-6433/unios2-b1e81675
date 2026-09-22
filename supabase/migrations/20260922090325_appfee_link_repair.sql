-- ====================================================================
-- Repair: application-fee heads that have paid_amount but no receipt link.
--
-- 20260922061648 moved each misallocated application-fee link from the course
-- head onto the Application Fee head. But it decremented the source head's
-- paid_amount BEFORE repointing the link, and fee_ledger carries an AFTER
-- UPDATE OF paid_amount trigger (trg_trim_fee_ledger_payment_links_on_unpay)
-- that trims links off a row whose paid_amount just dropped. So the trigger
-- deleted the link first and the repoint then matched no row.
--
-- Result: 11 FORM-FEE heads, ₹11,000 paid with linked_sum = 0. The UI shows
-- "₹1,000 of this head has no payment record linked to it".
--
-- This migration:
--   1. recreates reconcile_application_fee so it moves the link first;
--   2. relinks the orphaned heads from the student's own confirmed
--      application-fee receipts (no paid_amount change).
-- ====================================================================

-- 1. Move the link before touching paid_amount.
CREATE OR REPLACE FUNCTION public.reconcile_application_fee(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id     uuid;
  v_session_start  date;
  v_portal         numeric;
  v_app_code       uuid;
  v_app_row        public.fee_ledger%ROWTYPE;
  v_link           RECORD;
  v_pay            RECORD;
  v_move           numeric;
  v_moved          numeric := 0;
  v_applied        numeric := 0;
BEGIN
  SELECT s.id INTO v_student_id FROM public.students s WHERE s.lead_id = _lead_id LIMIT 1;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row');
  END IF;

  SELECT COALESCE(a.fee_amount, 0) INTO v_portal
    FROM public.applications a WHERE a.lead_id = _lead_id
    ORDER BY a.created_at DESC NULLS LAST LIMIT 1;
  v_portal := COALESCE(v_portal, 0);
  IF v_portal <= 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no portal application fee');
  END IF;

  SELECT COALESCE(sess.start_date, current_date) INTO v_session_start
    FROM public.students s
    LEFT JOIN public.admission_sessions sess ON sess.id = s.session_id
   WHERE s.id = v_student_id;

  SELECT fl.fee_code_id INTO v_app_code
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student_id
     AND fc.category = 'enrollment'
     AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
   ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END), fl.due_date NULLS LAST, fl.id
   LIMIT 1;
  IF v_app_code IS NULL THEN
    SELECT fsi.fee_code_id INTO v_app_code
      FROM public.fee_structure_items fsi
      JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
      JOIN public.fee_structures fs ON fs.id = fsi.fee_structure_id
      JOIN public.students s ON s.course_id = fs.course_id
     WHERE s.id = v_student_id
       AND fc.category = 'enrollment'
       AND (fc.code ILIKE '%FORM%' OR (fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
     ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END) LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    SELECT id INTO v_app_code FROM public.fee_codes WHERE code = 'FORM-FEE' LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no application-fee code');
  END IF;

  SELECT * INTO v_app_row FROM public.fee_ledger
   WHERE student_id = v_student_id AND fee_code_id = v_app_code
   ORDER BY due_date NULLS LAST, id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    VALUES (v_student_id, v_app_code, 'registration', v_portal, v_session_start, 'due')
    RETURNING * INTO v_app_row;
  END IF;

  -- (a) Move application-fee links that sit on a non-application head.
  FOR v_link IN
    SELECT flp.id AS link_id, flp.fee_ledger_id AS src_id, flp.amount AS link_amount,
           flp.lead_payment_id AS payment_id
      FROM public.fee_ledger_payments flp
      JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE fl.student_id = v_student_id
       AND lp.status = 'confirmed'
       AND lp.type = 'application_fee'
       AND fl.id <> v_app_row.id
       AND NOT (fc.code IN ('FORM-FEE','MR-REG','NB-REG') OR fc.name ILIKE '%application fee%')
  LOOP
    v_move := LEAST(
      v_link.link_amount,
      GREATEST(v_app_row.total_amount - v_app_row.concession - v_app_row.paid_amount, 0)
    );
    IF v_move <= 0 THEN CONTINUE; END IF;

    -- Repoint the receipt link BEFORE lowering the source head's paid_amount.
    -- trg_trim_fee_ledger_payment_links_on_unpay deletes links off a row whose
    -- paid_amount just dropped; if the link is still on the source it is
    -- removed and the move loses the receipt association.
    UPDATE public.fee_ledger_payments SET fee_ledger_id = v_app_row.id WHERE id = v_link.link_id;

    UPDATE public.fee_ledger
       SET paid_amount = GREATEST(paid_amount - v_move, 0),
           status = CASE
             WHEN GREATEST(paid_amount - v_move, 0) + COALESCE(concession, 0) >= total_amount THEN 'paid'
             WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 'overdue'
             ELSE 'due' END,
           updated_at = now()
     WHERE id = v_link.src_id;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_move,
           status = CASE WHEN paid_amount + v_move + COALESCE(concession, 0) >= total_amount THEN 'paid' ELSE status END,
           updated_at = now()
     WHERE id = v_app_row.id;

    INSERT INTO public.fee_ledger_reallocation_audit
      (student_id, action, from_fee_ledger_id, to_fee_ledger_id, from_fee_code, to_fee_code,
       from_term, to_term, amount, reason, actor_role, before_json, after_json)
    SELECT v_student_id, 'app_fee_head_repair', v_link.src_id, v_app_row.id,
           src_fc.code, dst_fc.code, src_fl.term, v_app_row.term, v_move,
           format('Application fee receipt moved off %s onto the Application Fee head', src_fc.code),
           'migration',
           jsonb_build_object('payment_id', v_link.payment_id, 'from_ledger_id', v_link.src_id),
           jsonb_build_object('to_ledger_id', v_app_row.id)
      FROM public.fee_ledger src_fl
      JOIN public.fee_codes src_fc ON src_fc.id = src_fl.fee_code_id
      LEFT JOIN public.fee_codes dst_fc ON dst_fc.id = v_app_row.fee_code_id
     WHERE src_fl.id = v_link.src_id;

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_link.payment_id;

    v_app_row.paid_amount := v_app_row.paid_amount + v_move;
    v_moved := v_moved + v_move;
  END LOOP;

  -- (b) Apply confirmed but unlinked application-fee receipts to the head.
  FOR v_pay IN
    SELECT lp.id, lp.amount
      FROM public.lead_payments lp
     WHERE lp.lead_id = _lead_id AND lp.status = 'confirmed' AND lp.type = 'application_fee'
       AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id)
     ORDER BY lp.created_at
  LOOP
    v_move := LEAST(
      v_pay.amount,
      GREATEST(v_app_row.total_amount - v_app_row.concession - v_app_row.paid_amount, 0)
    );
    IF v_move <= 0 THEN CONTINUE; END IF;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_move,
           status = CASE WHEN paid_amount + v_move + COALESCE(concession, 0) >= total_amount THEN 'paid' ELSE status END,
           updated_at = now()
     WHERE id = v_app_row.id;
    INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
    VALUES (v_app_row.id, v_pay.id, v_move, 0);

    v_app_row.paid_amount := v_app_row.paid_amount + v_move;
    v_applied := v_applied + v_move;
  END LOOP;

  IF v_moved > 0 OR v_applied > 0 THEN
    PERFORM public.sync_fee_ledger_concessions(v_student_id);
  END IF;

  RETURN jsonb_build_object(
    'student_id', v_student_id,
    'moved_from_wrong_heads', v_moved,
    'applied_unlinked', v_applied
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reconcile_application_fee(uuid) TO authenticated, service_role;

-- 2. Relink application-fee heads that have paid_amount but no links, from the
--    student's own confirmed application-fee receipts. Does not touch
--    paid_amount (the money is already booked); it only restores the receipt
--    association the unpay trigger removed.
DO $repair$
DECLARE
  r RECORD;
  p RECORD;
  v_gap  numeric;
  v_take numeric;
  v_fixed int := 0;
BEGIN
  FOR r IN
    SELECT fl.id AS head_id, fl.student_id, fl.paid_amount, fc.code AS fee_code,
           fl.paid_amount - COALESCE((
             SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp WHERE flp.fee_ledger_id = fl.id
           ), 0) AS gap
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE (fc.code IN ('FORM-FEE','MR-REG','NB-REG') OR fc.name ILIKE '%application fee%')
       AND fl.paid_amount > COALESCE((
             SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp WHERE flp.fee_ledger_id = fl.id
           ), 0) + 0.009
  LOOP
    v_gap := r.gap;

    FOR p IN
      SELECT lp.id, lp.amount,
             lp.amount - COALESCE((
               SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id
             ), 0) AS unlinked
        FROM public.lead_payments lp
       WHERE lp.status = 'confirmed'
         AND lp.type = 'application_fee'
         AND lp.lead_id = (SELECT s.lead_id FROM public.students s WHERE s.id = r.student_id)
         AND lp.amount - COALESCE((
               SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lp.id
             ), 0) > 0.009
       ORDER BY lp.created_at
    LOOP
      EXIT WHEN v_gap <= 0.009;
      v_take := LEAST(v_gap, p.unlinked);
      IF v_take <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (r.head_id, p.id, v_take, 0);

      UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = p.id;

      v_gap := v_gap - v_take;
    END LOOP;

    IF v_gap <= 0.009 THEN
      v_fixed := v_fixed + 1;
      RAISE NOTICE '[repair] relinked % (₹%) for student %', r.fee_code, r.paid_amount, r.student_id;
    ELSE
      RAISE WARNING '[repair] could not fully relink % for student % (₹% still unlinked)',
        r.fee_code, r.student_id, v_gap;
    END IF;
  END LOOP;

  RAISE NOTICE '[repair] application-fee heads relinked: %', v_fixed;
END $repair$;

NOTIFY pgrst, 'reload schema';
