-- provision_student_fees() marked payments applied even when it applied nothing.
--
-- Both the application_fee branch and the tuition/token branch set
-- v_mark_applied := true unconditionally, so a confirmed payment that found no
-- room on the ledger (app-fee head already settled, budget exhausted, or the
-- head not provisioned yet) was stamped applied_to_ledger = true having moved
-- ₹0. The money then reads as "handled" everywhere while never appearing on a
-- ledger row — the worst possible failure mode for a financial record, because
-- nothing surfaces it.
--
-- Real case that exposed it: a student added manually (so no lead_id) had three
-- confirmed payments sitting on her lead, two of them mis-typed as
-- application_fee. Linking the lead and re-provisioning would have applied ₹500
-- and silently written off ₹26,500.
--
-- Only the flag changes: a payment is marked applied when the full amount was
-- placed, otherwise it stays eligible and keeps showing as unapplied credit.
-- The allocation branch already did this correctly (v_alloc_fully).

CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE; v_student_id uuid; v_session public.admission_sessions%ROWTYPE;
  v_inserted int := 0; v_applied int := 0; v_total numeric := 0;
  v_lp RECORD; v_target RECORD;
  v_balance numeric; v_apply_total numeric; v_apply_amt numeric; v_apply_conc numeric;
  v_year_offset int; v_year_key text; v_session_start date; v_fs_id uuid;
  v_is_school boolean;
  v_budget numeric; v_already_paid numeric; v_confirmed numeric;
  v_app_fee numeric; v_app_code uuid;
  -- allocation locals
  v_alloc jsonb; v_fc uuid; v_alloc_amt numeric; v_already_fc numeric;
  v_remaining_alloc numeric; v_alloc_fully boolean; v_mark_applied boolean;
  -- row-targeted allocation locals
  v_fl uuid; v_row public.fee_ledger%ROWTYPE;
  -- how much of THIS payment actually landed on a ledger row
  v_placed numeric;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course'); END IF;
  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet'); END IF;
  SELECT * INTO v_session FROM public.admission_sessions WHERE id = v_lead.session_id;
  v_session_start := COALESCE(v_session.start_date, current_date);
  v_fs_id := public.lead_fee_structure_id(_lead_id);
  IF v_fs_id IS NULL THEN RETURN jsonb_build_object('skipped', true, 'reason', 'no matching fee_structure'); END IF;
  v_is_school := public.student_course_is_school(v_lead.course_id);

  -- College: ensure the structure's rows exist (idempotent).
  IF NOT v_is_school THEN
    WITH to_insert AS (
      SELECT fsi.fee_code_id, fsi.term, fsi.amount,
             COALESCE(fsi.due_date,
               CASE
                 WHEN fsi.due_month IS NOT NULL
                   THEN make_date(extract(year from v_session_start)::int + COALESCE(fsi.due_year_offset,0),
                                  fsi.due_month, LEAST(GREATEST(COALESCE(fsi.due_day,1),1),28))
                 WHEN fsi.term ~ '^year_[1-9]$'
                   THEN (v_session_start + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                         + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
                 ELSE NULL END, v_session_start) AS due_date
        FROM public.fee_structure_items fsi
       WHERE fsi.fee_structure_id = v_fs_id
         AND NOT EXISTS (SELECT 1 FROM public.fee_ledger fl
            WHERE fl.student_id = v_student_id AND fl.fee_code_id = fsi.fee_code_id AND fl.term = fsi.term))
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  -- Portal-defined application fee for this student's application.
  SELECT a.fee_amount INTO v_app_fee
    FROM public.applications a WHERE a.lead_id = _lead_id
    ORDER BY a.created_at DESC NULLS LAST LIMIT 1;
  v_app_fee := COALESCE(v_app_fee, 0);

  -- Resolve the application-fee fee_code for this student.
  SELECT fl.fee_code_id INTO v_app_code
    FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = v_student_id
     AND (fc.code ILIKE '%FORM%' OR (fc.category='enrollment' AND fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
   ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END), fl.due_date LIMIT 1;
  IF v_app_code IS NULL THEN
    SELECT fsi.fee_code_id INTO v_app_code
      FROM public.fee_structure_items fsi JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
     WHERE fsi.fee_structure_id = v_fs_id
       AND (fc.code ILIKE '%FORM%' OR (fc.category='enrollment' AND fc.code ILIKE '%REG%' AND fc.code NOT ILIKE '%REGION%'))
     ORDER BY (CASE WHEN fc.code ILIKE '%FORM%' THEN 0 ELSE 1 END) LIMIT 1;
  END IF;
  IF v_app_code IS NULL THEN
    SELECT id INTO v_app_code FROM public.fee_codes WHERE code = 'FORM-FEE' LIMIT 1;
  END IF;

  -- Budget: only create NEW credit up to (confirmed payments - already paid).
  SELECT COALESCE(SUM(paid_amount),0) INTO v_already_paid FROM public.fee_ledger WHERE student_id = v_student_id;
  SELECT COALESCE(SUM(amount),0) INTO v_confirmed FROM public.lead_payments
    WHERE lead_id = _lead_id AND status = 'confirmed';
  v_budget := GREATEST(v_confirmed - v_already_paid, 0);

  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false
       AND ( allocations IS NOT NULL
             OR NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments flp WHERE flp.lead_payment_id = lead_payments.id) )
     ORDER BY (type = 'application_fee') DESC, created_at
  LOOP
    v_mark_applied := true;
    v_placed := 0;

    IF v_lp.allocations IS NOT NULL AND jsonb_array_length(v_lp.allocations) > 0 THEN
      v_alloc_fully := true;
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_lp.allocations) LOOP
        v_fc := (v_alloc->>'fee_code_id')::uuid;
        v_fl := NULLIF(v_alloc->>'fee_ledger_id','')::uuid;
        v_alloc_amt := COALESCE((v_alloc->>'amount')::numeric, 0);
        IF v_alloc_amt <= 0 THEN CONTINUE; END IF;

        IF v_fl IS NOT NULL THEN
          SELECT * INTO v_row FROM public.fee_ledger
           WHERE id = v_fl AND student_id = v_student_id;
          IF NOT FOUND THEN v_alloc_fully := false; CONTINUE; END IF;

          SELECT COALESCE(SUM(flp.amount),0) INTO v_already_fc
            FROM public.fee_ledger_payments flp
           WHERE flp.lead_payment_id = v_lp.id AND flp.fee_ledger_id = v_fl;
          v_remaining_alloc := v_alloc_amt - v_already_fc;
          IF v_remaining_alloc <= 0 THEN CONTINUE; END IF;

          v_balance := v_row.total_amount - v_row.concession - v_row.paid_amount;
          v_apply_amt := LEAST(v_balance, v_remaining_alloc, v_budget);
          IF v_apply_amt > 0 THEN
            UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                   status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                   updated_at = now()
             WHERE id = v_fl;
            INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
            VALUES (v_fl, v_lp.id, v_apply_amt, 0);
            v_budget := v_budget - v_apply_amt;
            v_remaining_alloc := v_remaining_alloc - v_apply_amt;
          END IF;
          IF v_remaining_alloc > 0.009 THEN v_alloc_fully := false; END IF;
          CONTINUE;
        END IF;

        IF v_fc IS NULL THEN CONTINUE; END IF;

        SELECT COALESCE(SUM(flp.amount),0) INTO v_already_fc
          FROM public.fee_ledger_payments flp JOIN public.fee_ledger fl2 ON fl2.id = flp.fee_ledger_id
         WHERE flp.lead_payment_id = v_lp.id AND fl2.fee_code_id = v_fc;
        v_remaining_alloc := v_alloc_amt - v_already_fc;
        IF v_remaining_alloc <= 0 THEN CONTINUE; END IF;

        FOR v_target IN
          SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
            FROM public.fee_ledger fl
           WHERE fl.student_id = v_student_id AND fl.fee_code_id = v_fc
             AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
           ORDER BY fl.due_date NULLS LAST, fl.term, fl.id
        LOOP
          EXIT WHEN v_remaining_alloc <= 0 OR v_budget <= 0;
          v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
          v_apply_amt := LEAST(v_balance, v_remaining_alloc, v_budget);
          IF v_apply_amt <= 0 THEN CONTINUE; END IF;
          UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                 status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
          v_budget := v_budget - v_apply_amt;
          v_remaining_alloc := v_remaining_alloc - v_apply_amt;
        END LOOP;

        IF v_remaining_alloc > 0.009 THEN v_alloc_fully := false; END IF;
      END LOOP;
      v_mark_applied := v_alloc_fully;

    ELSIF v_lp.type = 'application_fee' THEN
      IF v_budget > 0 AND v_app_fee > 0 AND v_app_code IS NOT NULL THEN
        SELECT id, total_amount, paid_amount, concession INTO v_target FROM public.fee_ledger
         WHERE student_id = v_student_id AND fee_code_id = v_app_code ORDER BY due_date LIMIT 1;
        IF v_target.id IS NULL THEN
          INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
          VALUES (v_student_id, v_app_code, 'registration', v_app_fee, v_session_start, 'due')
          RETURNING id, total_amount, paid_amount, concession INTO v_target;
        END IF;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        v_apply_amt := LEAST(v_lp.amount, GREATEST(v_balance,0), v_budget);
        IF v_apply_amt > 0 THEN
          UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
                 status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
          v_budget := v_budget - v_apply_amt;
          v_placed := v_placed + v_apply_amt;
        END IF;
      END IF;
      -- Was the whole payment placed? An application_fee payment bigger than the
      -- app-fee head (or arriving after it settled) must stay eligible, not be
      -- written off.
      v_mark_applied := v_placed >= v_lp.amount - 0.009;
    ELSE
      FOR v_target IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.student_id = v_student_id
           AND ( (NOT v_is_school AND fl.term ~ '^year_[1-9]$')
                 OR (v_is_school AND fl.term ~ '^q[1-4]$' AND fc.category IN ('tuition','hostel')) )
           AND (fl.total_amount - fl.concession - fl.paid_amount) > 0
         ORDER BY fl.due_date, fl.total_amount DESC
      LOOP
        EXIT WHEN v_budget <= 0;
        v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
        v_apply_amt := LEAST(v_balance, v_budget);
        IF v_apply_amt <= 0 THEN CONTINUE; END IF;
        UPDATE public.fee_ledger SET paid_amount = paid_amount + v_apply_amt,
               status = CASE WHEN paid_amount + v_apply_amt + concession >= total_amount THEN 'paid' ELSE status END,
               updated_at = now()
         WHERE id = v_target.id;
        INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
        VALUES (v_target.id, v_lp.id, v_apply_amt, 0);
        v_budget := v_budget - v_apply_amt;
        v_placed := v_placed + v_apply_amt;
      END LOOP;
      v_mark_applied := v_placed >= v_lp.amount - 0.009;
    END IF;

    IF v_mark_applied THEN
      UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('student_id', v_student_id, 'ledger_rows_created', v_inserted,
    'payments_applied', v_applied, 'app_fee', v_app_fee);
END;
$function$;

-- Reconciliation guardrail. Per student, compares confirmed payments on their
-- lead against what the ledger records as paid, and flags a student with no
-- lead_id whose phone matches a lead still holding money or approved waivers.
--
-- Deliberately NOT per-payment: the edge-function provisioning path credits
-- fee_ledger.paid_amount without always writing a fee_ledger_payments link, so
-- a link-based check reports ~5.8L of correctly-applied money as missing.
CREATE OR REPLACE VIEW public.student_fee_reconciliation AS
SELECT s.id                                   AS student_id,
       s.name                                 AS student_name,
       COALESCE(s.admission_no, s.pre_admission_no) AS student_no,
       s.status::text                         AS student_status,
       s.lead_id,
       COALESCE(p.confirmed, 0)               AS confirmed_payments,
       COALESCE(fl.ledger_paid, 0)            AS ledger_paid,
       COALESCE(p.confirmed, 0) - COALESCE(fl.ledger_paid, 0) AS difference,
       COALESCE(fl.ledger_rows, 0)            AS ledger_rows,
       CASE
         WHEN s.lead_id IS NULL AND COALESCE(orphan.orphan_paid,0) + COALESCE(orphan.orphan_waived,0) > 0
           THEN 'orphaned_student_lead_not_linked'
         WHEN COALESCE(fl.ledger_rows, 0) = 0 AND COALESCE(p.confirmed, 0) > 0 THEN 'fees_not_provisioned'
         WHEN COALESCE(p.confirmed, 0) - COALESCE(fl.ledger_paid, 0) > 0.009 THEN 'payment_not_on_ledger'
         WHEN COALESCE(fl.ledger_paid, 0) - COALESCE(p.confirmed, 0) > 0.009 THEN 'ledger_paid_exceeds_payments'
         ELSE 'ok'
       END                                    AS issue,
       orphan.lead_id                         AS candidate_lead_id,
       orphan.orphan_paid                     AS candidate_lead_payments,
       orphan.orphan_waived                   AS candidate_lead_waivers
  FROM public.students s
  LEFT JOIN LATERAL (
        SELECT SUM(lp.amount) AS confirmed
          FROM public.lead_payments lp
         WHERE lp.lead_id = s.lead_id AND lp.status = 'confirmed'
       ) p ON TRUE
  LEFT JOIN LATERAL (
        SELECT SUM(f.paid_amount) AS ledger_paid, COUNT(*) AS ledger_rows
          FROM public.fee_ledger f
         WHERE f.student_id = s.id
       ) fl ON TRUE
  LEFT JOIN LATERAL (
        SELECT l.id AS lead_id, x.orphan_paid, x.orphan_waived
          FROM public.leads l
          CROSS JOIN LATERAL (
               SELECT (SELECT COALESCE(SUM(lp2.amount),0) FROM public.lead_payments lp2
                        WHERE lp2.lead_id = l.id AND lp2.status = 'confirmed') AS orphan_paid,
                      (SELECT COALESCE(SUM(w.amount),0) FROM public.offer_waivers w
                         JOIN public.offer_letters o ON o.id = w.offer_letter_id
                        WHERE o.lead_id = l.id AND w.status = 'approved'
                          AND o.approval_status = 'approved') AS orphan_waived
          ) x
         WHERE s.lead_id IS NULL
           AND right(regexp_replace(COALESCE(l.phone,''), '\D', '', 'g'), 10) <> ''
           AND right(regexp_replace(COALESCE(l.phone,''), '\D', '', 'g'), 10) IN (
                 right(regexp_replace(COALESCE(s.phone,''), '\D', '', 'g'), 10),
                 right(regexp_replace(COALESCE(s.father_phone,''), '\D', '', 'g'), 10))
           AND NOT EXISTS (SELECT 1 FROM public.students s2 WHERE s2.lead_id = l.id)
         -- the lead actually holding money wins, not merely the newest one
         ORDER BY (x.orphan_paid + x.orphan_waived) DESC, l.created_at DESC
         LIMIT 1
       ) orphan ON TRUE
 WHERE s.deleted_at IS NULL;

REVOKE ALL ON public.student_fee_reconciliation FROM anon;
GRANT SELECT ON public.student_fee_reconciliation TO authenticated, service_role;
