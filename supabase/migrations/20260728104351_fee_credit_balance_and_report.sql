-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260728104351 name=fee_credit_balance_and_report applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.student_fee_credit_balance(_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE VIEW public.student_fee_credit_balances
WITH (security_invoker = true) AS
WITH form AS (
  SELECT id FROM public.fee_codes
   WHERE code ILIKE '%FORM%' OR code ILIKE '%APPLICATION%'
   ORDER BY (CASE WHEN code = 'FORM-FEE' THEN 0 ELSE 1 END) LIMIT 1
)
SELECT s.id AS student_id, s.lead_id AS lead_id,
  COALESCE(p.appfee_paid, 0) AS application_fee_paid,
  GREATEST(0, COALESCE(p.other_paid, 0) - COALESCE(l.nonform_paid, 0)) AS general_credit
FROM public.students s
LEFT JOIN LATERAL (
  SELECT SUM(amount) FILTER (WHERE type = 'application_fee')  AS appfee_paid,
         SUM(amount) FILTER (WHERE type <> 'application_fee') AS other_paid
  FROM public.lead_payments lp WHERE lp.lead_id = s.lead_id AND lp.status = 'confirmed'
) p ON true
LEFT JOIN LATERAL (
  SELECT SUM(fl.paid_amount) AS nonform_paid
  FROM public.fee_ledger fl
  WHERE fl.student_id = s.id AND fl.fee_code_id IS DISTINCT FROM (SELECT id FROM form)
) l ON true;
GRANT SELECT ON public.student_fee_credit_balances TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fee_reconciliation_report()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
          FROM public.fee_ledger fl JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.paid_amount > 0
           AND NOT EXISTS (SELECT 1 FROM public.fee_ledger_payments p WHERE p.fee_ledger_id = fl.id)
         ORDER BY fl.paid_amount DESC ) x),
    'paid_exceeds_payments', (SELECT COALESCE(jsonb_agg(y), '[]') FROM (
        SELECT s.id AS student_id, s.name,
               (SELECT COALESCE(SUM(paid_amount),0) FROM public.fee_ledger WHERE student_id = s.id) AS paid,
               (SELECT COALESCE(SUM(amount),0) FROM public.lead_payments WHERE lead_id = s.lead_id AND status='confirmed') AS payments
          FROM public.students s
         WHERE (SELECT COALESCE(SUM(paid_amount),0) FROM public.fee_ledger WHERE student_id = s.id)
             > (SELECT COALESCE(SUM(amount),0) FROM public.lead_payments WHERE lead_id = s.lead_id AND status='confirmed') ) y)
  ) INTO r;
  RETURN r;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fee_reconciliation_report() TO authenticated, service_role;
