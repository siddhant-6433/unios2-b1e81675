-- Fee-module hardening, step 1: derived credit balance + reconciliation report +
-- retire the inert term='advance' carry-over in provision_student_fees.
--
-- Model: fee_ledger.paid_amount stays authoritative. Credit is DERIVED, not stored.
-- Application-fee money is earmarked to the FORM-FEE head and excluded from general
-- credit (owner rule: application fee adjusts only against application fee).
--   general_credit = GREATEST(0, SUM(confirmed payments where type<>'application_fee')
--                                - SUM(fee_ledger.paid_amount where fee_code<>FORM-FEE))
--
-- Also fixes a blocking bug: deleting a fee_ledger row fires fn_audit_anomaly_alert,
-- which inserts a 'finance_audit_anomaly' notification — a value missing from
-- notifications_type_check, so EVERY fee_ledger delete rolled back (broke
-- force_reprovision, the edit-lock escape hatch, and re-provisioning). Widen the check.

-- 0. Allow the finance anomaly-alert notification type.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
 'lead_assigned','sla_warning','lead_reclaimed','followup_due','followup_overdue','visit_confirmation_due',
 'visit_followup_due','lead_transferred','deletion_request','whatsapp_message','whatsapp_sla_warning',
 'whatsapp_sla_breach','approval_pending','approval_decided','template_status_update','tat_defaults_report',
 'post_visit_nudge','score_penalty','lead_bucket_backlog','feedback_received','campaign_completed',
 'student_service_assigned','student_service_unassigned','pgdm_certificate_pending','pgdm_certificate_approved',
 'pgdm_diploma_ready','general','visit_due','missed_call','callback_requested','notice_published',
 'gatepass_update','assignment_due','substitution_assigned','leave_decision','hostel_alert','approval_request',
 'payment_receipt','finance_audit_anomaly'
]));

-- 1. Scalar credit balance. Accepts a lead_id OR a student_id (resolved to its lead).
CREATE OR REPLACE FUNCTION public.student_fee_credit_balance(_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH resolved AS (
    SELECT COALESCE((SELECT lead_id FROM public.students WHERE id = _id), _id) AS lead_id
  ),
  form AS (
    SELECT id FROM public.fee_codes
     WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
     ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1
  ),
  pay AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee'), 0)  AS appfee_paid,
      COALESCE(SUM(amount) FILTER (WHERE type <> 'application_fee'), 0) AS other_paid
    FROM public.lead_payments
    WHERE lead_id = (SELECT lead_id FROM resolved) AND status = 'confirmed'
  ),
  led AS (
    SELECT COALESCE(SUM(fl.paid_amount), 0) AS nonform_paid
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
    WHERE s.lead_id = (SELECT lead_id FROM resolved)
      AND fl.fee_code_id IS DISTINCT FROM (SELECT id FROM form)
  )
  SELECT jsonb_build_object(
    'application_fee_paid', (SELECT appfee_paid FROM pay),
    'general_credit',      GREATEST(0, (SELECT other_paid FROM pay) - (SELECT nonform_paid FROM led))
  );
$function$;

GRANT EXECUTE ON FUNCTION public.student_fee_credit_balance(uuid) TO authenticated, service_role;

-- 2. Set-returning view for list screens (respects RLS on the underlying tables).
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
  WHERE lp.lead_id = s.lead_id AND lp.status = 'confirmed'
) p ON true
LEFT JOIN LATERAL (
  SELECT SUM(fl.paid_amount) AS nonform_paid
  FROM public.fee_ledger fl
  WHERE fl.student_id = s.id
    AND fl.fee_code_id IS DISTINCT FROM (SELECT id FROM form)
) l ON true;

GRANT SELECT ON public.student_fee_credit_balances TO authenticated, service_role;

-- 3. Reconciliation report (read-only; finance roles only). Surfaces legacy anomalies
--    for manual review — does NOT mutate anything.
CREATE OR REPLACE FUNCTION public.fee_reconciliation_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'accountant')
       OR public.has_role(auth.uid(), 'campus_admin')
       OR public.has_role(auth.uid(), 'principal')) THEN
    RAISE EXCEPTION 'Not authorized to view fee reconciliation report';
  END IF;

  SELECT jsonb_build_object(
    'orphan_paid_heads', (SELECT COALESCE(jsonb_agg(x), '[]') FROM (
        SELECT fl.id AS fee_ledger_id, fl.student_id, fc.code AS fee_code, fl.term, fl.paid_amount
          FROM public.fee_ledger fl
          JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.paid_amount > 0
           AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments p WHERE p.fee_ledger_id = fl.id)
         ORDER BY fl.paid_amount DESC
      ) x),
    'paid_exceeds_payments', (SELECT COALESCE(jsonb_agg(y), '[]') FROM (
        SELECT s.id AS student_id, s.name,
               (SELECT COALESCE(SUM(paid_amount),0) FROM public.fee_ledger WHERE student_id = s.id) AS paid,
               (SELECT COALESCE(SUM(amount),0) FROM public.lead_payments WHERE lead_id = s.lead_id AND status='confirmed') AS payments
          FROM public.students s
         WHERE (SELECT COALESCE(SUM(paid_amount),0) FROM public.fee_ledger WHERE student_id = s.id)
             > (SELECT COALESCE(SUM(amount),0) FROM public.lead_payments WHERE lead_id = s.lead_id AND status='confirmed')
      ) y)
  ) INTO r;
  RETURN r;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fee_reconciliation_report() TO authenticated, service_role;

-- 4. provision_student_fees — retire the term='advance' carry-over. Anything a
--    payment can't be absorbed by now stays UNAPPLIED (= derived credit), applied
--    later by apply_student_credit. Byte-identical to the live definition except the
--    removed carry-over block. (advance rows in prod = 0, so no data migration.)
CREATE OR REPLACE FUNCTION public.provision_student_fees(_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead         public.leads%ROWTYPE;
  v_student_id   uuid;
  v_session      public.admission_sessions%ROWTYPE;
  v_inserted     int := 0;
  v_applied      int := 0;
  v_total        numeric := 0;
  v_lp           RECORD;
  v_target       RECORD;
  v_form_code    uuid;
  v_reg_code     uuid;
  v_remaining_amt   numeric;
  v_remaining_conc  numeric;
  v_remaining_total numeric;
  v_balance         numeric;
  v_apply_total     numeric;
  v_apply_amt       numeric;
  v_apply_conc      numeric;
  v_year_conc       numeric;
  v_year_key        text;
  v_year_offset     int;
  v_session_start   date;
  v_fs_id           uuid;
  v_is_school       boolean;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = _lead_id;
  IF NOT FOUND OR v_lead.session_id IS NULL OR v_lead.course_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing lead/session/course');
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE lead_id = _lead_id;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no student row yet');
  END IF;

  SELECT * INTO v_session FROM public.admission_sessions WHERE id = v_lead.session_id;
  v_session_start := COALESCE(v_session.start_date, current_date);

  v_fs_id := public.lead_fee_structure_id(_lead_id);
  IF v_fs_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no matching fee_structure');
  END IF;

  -- SCHOOL SAFETY: this SQL provisioner is MODE-UNAWARE — it would insert every
  -- fee_structure_item (all boarding/transport tiers, both tuition variants),
  -- inflating a boarder/day-scholar ledger. School heads are built by the
  -- mode-aware edge fn / recompute_lead_fee_stage; here we skip the item-insert
  -- for school courses and only apply payments (part b). College is unchanged.
  v_is_school := public.student_course_is_school(v_lead.course_id);

  -- (a) Provision ledger from fee_structure_items (non-school only).
  IF NOT v_is_school THEN
    WITH to_insert AS (
      SELECT fsi.fee_code_id, fsi.term, fsi.amount,
             CASE
               WHEN fsi.term ~ '^year_[1-9]$'
                 THEN (v_session_start
                       + ((substring(fsi.term FROM 'year_(\d+)')::int - 1) || ' years')::interval
                       + ((COALESCE(fsi.due_day,1) - 1) || ' days')::interval)::date
               ELSE v_session_start
             END AS due_date
        FROM public.fee_structure_items fsi
       WHERE fsi.fee_structure_id = v_fs_id
         AND NOT EXISTS (
           SELECT 1 FROM public.fee_ledger fl
            WHERE fl.student_id = v_student_id
              AND fl.fee_code_id = fsi.fee_code_id
              AND fl.term        = fsi.term
         )
    )
    INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
    SELECT v_student_id, fee_code_id, term, amount, due_date, 'due' FROM to_insert;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  SELECT id INTO v_form_code FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1;
  SELECT id INTO v_reg_code FROM public.fee_codes
   WHERE code ILIKE '%REG%' AND code NOT ILIKE '%REGION%'
   ORDER BY (CASE WHEN code = 'MR-REG' THEN 0 WHEN code = 'NB-REG' THEN 0 ELSE 1 END) LIMIT 1;

  -- (b) Apply each unapplied confirmed lead_payment.
  FOR v_lp IN
    SELECT * FROM public.lead_payments
     WHERE lead_id = _lead_id AND status = 'confirmed' AND applied_to_ledger = false
     ORDER BY created_at
  LOOP
    v_remaining_amt   := COALESCE(v_lp.amount, 0);
    v_remaining_conc  := COALESCE(v_lp.concession_amount, 0);
    v_remaining_total := v_remaining_amt + v_remaining_conc;

    IF v_lp.type = 'application_fee' AND v_form_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_form_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_form_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt   := v_remaining_amt   - v_apply_amt;
      v_remaining_conc  := v_remaining_conc  - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type = 'registration_fee' AND v_reg_code IS NOT NULL THEN
      SELECT id, total_amount, paid_amount, concession INTO v_target
        FROM public.fee_ledger
       WHERE student_id = v_student_id AND fee_code_id = v_reg_code
       ORDER BY due_date LIMIT 1;
      IF v_target.id IS NULL THEN
        INSERT INTO public.fee_ledger (student_id, fee_code_id, term, total_amount, due_date, status)
        VALUES (v_student_id, v_reg_code, 'one_time', GREATEST(v_remaining_total, 1), v_session_start, 'due')
        RETURNING id, total_amount, paid_amount, concession INTO v_target;
      END IF;
      v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
      v_apply_total := LEAST(v_remaining_total, GREATEST(v_balance, 0));
      IF v_apply_total <= 0 THEN v_apply_total := v_remaining_total; END IF;
      v_apply_amt  := CASE WHEN v_remaining_total > 0
                           THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
      v_apply_conc := v_apply_total - v_apply_amt;
      UPDATE public.fee_ledger
         SET paid_amount = paid_amount + v_apply_amt,
             concession  = concession  + v_apply_conc,
             status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
             updated_at = now()
       WHERE id = v_target.id;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
      VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);
      v_remaining_amt   := v_remaining_amt   - v_apply_amt;
      v_remaining_conc  := v_remaining_conc  - v_apply_conc;
      v_remaining_total := v_remaining_amt + v_remaining_conc;

    ELSIF v_lp.type IN ('token_fee', 'other') THEN
      FOR v_year_offset IN 1..8 LOOP
        EXIT WHEN v_remaining_total <= 0;
        v_year_key := 'year_' || v_year_offset::text;
        v_year_conc := COALESCE((v_lp.concession_breakdown ->> v_year_key)::numeric, NULL);
        FOR v_target IN
          SELECT id, total_amount, paid_amount, concession FROM public.fee_ledger
           WHERE student_id = v_student_id AND term = v_year_key
           ORDER BY due_date
        LOOP
          EXIT WHEN v_remaining_total <= 0;
          v_balance := v_target.total_amount - v_target.concession - v_target.paid_amount;
          IF v_balance <= 0 THEN CONTINUE; END IF;

          v_apply_total := LEAST(v_remaining_total, v_balance);
          IF v_lp.concession_breakdown IS NOT NULL AND v_year_conc IS NOT NULL THEN
            v_apply_conc := LEAST(GREATEST(v_year_conc, 0), GREATEST(v_remaining_conc, 0), v_apply_total);
            v_apply_amt  := v_apply_total - v_apply_conc;
          ELSE
            v_apply_amt  := CASE WHEN v_remaining_total > 0
                                 THEN ROUND(v_apply_total * v_remaining_amt / v_remaining_total, 2) ELSE 0 END;
            v_apply_conc := v_apply_total - v_apply_amt;
          END IF;

          UPDATE public.fee_ledger
             SET paid_amount = paid_amount + v_apply_amt,
                 concession  = concession  + v_apply_conc,
                 status = CASE WHEN paid_amount + v_apply_amt + concession + v_apply_conc >= total_amount THEN 'paid' ELSE 'due' END,
                 updated_at = now()
           WHERE id = v_target.id;
          INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount)
          VALUES (v_target.id, v_lp.id, v_apply_amt, v_apply_conc);

          v_remaining_amt   := v_remaining_amt   - v_apply_amt;
          v_remaining_conc  := v_remaining_conc  - v_apply_conc;
          v_remaining_total := v_remaining_amt + v_remaining_conc;
          IF v_year_conc IS NOT NULL THEN v_year_conc := v_year_conc - v_apply_conc; END IF;
        END LOOP;
      END LOOP;
    END IF;

    -- (advance carry-over REMOVED): any v_remaining_total stays unapplied and shows as
    -- derived credit; apply_student_credit posts it to heads earliest-due-first later.

    UPDATE public.lead_payments SET applied_to_ledger = true WHERE id = v_lp.id;
    v_applied := v_applied + 1;
    v_total   := v_total + COALESCE(v_lp.amount, 0) + COALESCE(v_lp.concession_amount, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'student_id',          v_student_id,
    'ledger_rows_created', v_inserted,
    'payments_applied',    v_applied,
    'total_credited',      v_total
  );
END;
$function$;
