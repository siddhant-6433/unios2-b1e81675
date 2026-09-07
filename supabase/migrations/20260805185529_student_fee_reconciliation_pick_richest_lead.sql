-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260805185529 name=student_fee_reconciliation_pick_richest_lead applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
