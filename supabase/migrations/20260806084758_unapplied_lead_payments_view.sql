-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260806084758 name=unapplied_lead_payments_view applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE VIEW public.unapplied_lead_payments AS
SELECT p.id            AS lead_payment_id,
       p.lead_id,
       l.name          AS lead_name,
       l.phone         AS lead_phone,
       s.id            AS student_id,
       s.name          AS student_name,
       p.type::text    AS payment_type,
       p.amount,
       COALESCE((SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp
                  WHERE flp.lead_payment_id = p.id), 0) AS applied_amount,
       p.amount - COALESCE((SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp
                             WHERE flp.lead_payment_id = p.id), 0) AS unapplied_amount,
       p.applied_to_ledger,
       p.created_at
  FROM public.lead_payments p
  JOIN public.leads l ON l.id = p.lead_id
  LEFT JOIN public.students s ON s.lead_id = p.lead_id
 WHERE p.status = 'confirmed'
   AND p.amount - COALESCE((SELECT SUM(flp.amount) FROM public.fee_ledger_payments flp
                             WHERE flp.lead_payment_id = p.id), 0) > 0.009;

REVOKE ALL ON public.unapplied_lead_payments FROM anon;
GRANT SELECT ON public.unapplied_lead_payments TO authenticated, service_role;
