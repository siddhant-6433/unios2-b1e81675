-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260806084942 name=duplicate_payment_application_guard applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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

DO $$
DECLARE
  t         record;
  r         record;
  v_excess  numeric;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('f27f14f4-fb2c-4014-8d75-0f271f319c94'::uuid, 62500.00, 37500.00),
      ('b5d71162-e74f-4b2a-9ce3-8ca7bb6a441f'::uuid,  9000.00,  5000.00),
      ('7b0e3295-c03e-4d9d-b09e-62e96920f525'::uuid,  1000.00,     0.00)
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
      RAISE NOTICE '[repair] % row % changed since diagnosis — skipped', r.name, r.id;
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

    RAISE NOTICE '[repair] % row %: paid % -> % (removed %)', r.name, r.id, r.paid_amount, r.linked, v_excess;
  END LOOP;
END $$;
