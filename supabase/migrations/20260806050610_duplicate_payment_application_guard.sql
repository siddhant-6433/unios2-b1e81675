-- Stop a payment being applied to the ledger twice, and surface it when it is.
--
-- Root cause this closes: two systems credit fee_ledger.paid_amount — the edge
-- provisioner (at row insert) and provision_student_fees() — and before
-- 2026-07-30 the SQL side had no budget guard. The 2026-05-21 backfill
-- (20260521151428_backfill_unapplied_lead_payments) therefore re-applied
-- payments the edge provisioner had already credited. Two students ended up
-- with more paid on the ledger than money ever received: Bhavna +25,000 (her
-- first token counted twice) and Diya Sharma +5,000.
--
-- Three layers here:
--   1. A trigger that refuses to apply more of a payment than the payment is
--      worth. Narrow by design: it never judges a student's overall balance,
--      only "this transaction cannot be spent twice", so it cannot block a
--      legitimate collection at the counter.
--   2. Views that surface duplicates the trigger cannot prevent — the same real
--      transaction recorded as two payment rows, and ledger credit with no
--      payment behind it at all.
--   3. The repair for the two damaged students (bottom of this file).

-- ── 1. Prevent over-application of a single payment ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_guard_payment_over_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment numeric;
  v_applied numeric;
BEGIN
  SELECT amount INTO v_payment FROM public.lead_payments WHERE id = NEW.lead_payment_id;
  IF v_payment IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_applied
    FROM public.fee_ledger_payments
   WHERE lead_payment_id = NEW.lead_payment_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_applied + NEW.amount > v_payment + 0.009 THEN
    RAISE EXCEPTION
      'Payment % is already applied to the ledger for % of its % — refusing to apply another %. This transaction cannot be spent twice.',
      NEW.lead_payment_id, v_applied, v_payment, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS fee_ledger_payments_guard_over_application ON public.fee_ledger_payments;
CREATE TRIGGER fee_ledger_payments_guard_over_application
BEFORE INSERT OR UPDATE OF amount ON public.fee_ledger_payments
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_payment_over_application();

-- ── 2a. Ledger credit with no payment behind it ──────────────────────────────
-- paid_amount that no fee_ledger_payments row accounts for. Some of this is
-- historic (the edge provisioner wrote no links until now); anything appearing
-- here after this migration is a real defect.
CREATE OR REPLACE VIEW public.v_unaccounted_ledger_credit AS
SELECT s.id                AS student_id,
       s.name              AS student_name,
       s.admission_no,
       s.pre_admission_no,
       SUM(fl.paid_amount) AS ledger_paid,
       COALESCE(SUM(l.linked), 0) AS linked_to_payments,
       SUM(fl.paid_amount) - COALESCE(SUM(l.linked), 0) AS unaccounted
  FROM public.fee_ledger fl
  JOIN public.students s ON s.id = fl.student_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(flp.amount), 0) AS linked
      FROM public.fee_ledger_payments flp
     WHERE flp.fee_ledger_id = fl.id
  ) l ON TRUE
 WHERE s.deleted_at IS NULL
 GROUP BY s.id, s.name, s.admission_no, s.pre_admission_no
HAVING SUM(fl.paid_amount) - COALESCE(SUM(l.linked), 0) > 0.009;

-- ── 2b. The same real transaction recorded twice ─────────────────────────────
-- A gateway reference is unique per transaction, so two confirmed rows sharing
-- one is a duplicate. Same-day same-amount duplicates on a lead are flagged as
-- suspected — cash instalments can legitimately repeat, so they need a human.
CREATE OR REPLACE VIEW public.v_duplicate_payments AS
SELECT 'same_transaction_ref'::text AS kind,
       p.lead_id,
       l.name AS lead_name,
       p.transaction_ref::text AS match_key,
       COUNT(*) AS payment_count,
       SUM(p.amount) AS total_amount,
       array_agg(p.id ORDER BY p.created_at) AS payment_ids
  FROM public.lead_payments p
  JOIN public.leads l ON l.id = p.lead_id
 WHERE p.status = 'confirmed'
   AND NULLIF(btrim(COALESCE(p.transaction_ref, '')), '') IS NOT NULL
 GROUP BY p.lead_id, l.name, p.transaction_ref
HAVING COUNT(*) > 1
UNION ALL
SELECT 'suspected_same_day_amount',
       p.lead_id,
       l.name,
       p.amount::text || ' on ' || COALESCE(p.payment_date::date, p.created_at::date)::text,
       COUNT(*),
       SUM(p.amount),
       array_agg(p.id ORDER BY p.created_at)
  FROM public.lead_payments p
  JOIN public.leads l ON l.id = p.lead_id
 WHERE p.status = 'confirmed'
 GROUP BY p.lead_id, l.name, p.amount, COALESCE(p.payment_date::date, p.created_at::date)
HAVING COUNT(*) > 1;

REVOKE ALL ON public.v_unaccounted_ledger_credit FROM anon;
REVOKE ALL ON public.v_duplicate_payments FROM anon;
GRANT SELECT ON public.v_unaccounted_ledger_credit TO authenticated, service_role;
GRANT SELECT ON public.v_duplicate_payments TO authenticated, service_role;

-- ── 3. Repair the two students damaged by the 2026-05-21 backfill ────────────
-- Reduce paid_amount to the money actually received. Only the unlinked excess
-- is removed; every rupee backed by a fee_ledger_payments row is left alone.
-- Guarded so it is a no-op if the rows were already corrected by hand.
-- Targeted by ledger row id, with the diagnosed figures asserted: if a row no
-- longer looks the way it did when this was traced (someone corrected it, a
-- real payment arrived), it is skipped rather than overwritten.
DO $$
DECLARE
  t         record;
  r         record;
  v_excess  numeric;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      -- ledger row,                              expected paid, expected linked
      ('f27f14f4-fb2c-4014-8d75-0f271f319c94'::uuid, 62500.00, 37500.00),  -- Bhavna  TUITION-Y1
      ('b5d71162-e74f-4b2a-9ce3-8ca7bb6a441f'::uuid,  9000.00,  5000.00),  -- Diya    TUITION-Y2
      ('7b0e3295-c03e-4d9d-b09e-62e96920f525'::uuid,  1000.00,     0.00)   -- Diya    TUITION-Y1
    ) AS v(ledger_id, expected_paid, expected_linked)
  LOOP
    SELECT fl.id, fl.paid_amount, fl.concession, fl.total_amount, fl.due_date, s.name,
           COALESCE((SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp
                      WHERE flp.fee_ledger_id = fl.id), 0) AS linked
      INTO r
      FROM public.fee_ledger fl
      JOIN public.students s ON s.id = fl.student_id
     WHERE fl.id = t.ledger_id;

    IF NOT FOUND THEN
      RAISE NOTICE '[repair] ledger row % not found — skipped', t.ledger_id;
      CONTINUE;
    END IF;

    IF r.paid_amount <> t.expected_paid OR r.linked <> t.expected_linked THEN
      RAISE NOTICE '[repair] % row % changed since diagnosis (paid %/% linked %/%) — skipped, needs a fresh look',
        r.name, r.id, r.paid_amount, t.expected_paid, r.linked, t.expected_linked;
      CONTINUE;
    END IF;

    v_excess := r.paid_amount - r.linked;
    UPDATE public.fee_ledger
       SET paid_amount = r.linked,
           status = CASE
                      WHEN r.linked + r.concession >= r.total_amount THEN 'paid'
                      WHEN r.due_date < CURRENT_DATE THEN 'overdue'
                      ELSE 'due'
                    END,
           updated_at = now()
     WHERE id = r.id;

    RAISE NOTICE '[repair] % row %: paid % -> % (removed % of credit with no payment behind it)',
      r.name, r.id, r.paid_amount, r.linked, v_excess;
  END LOOP;
END $$;
