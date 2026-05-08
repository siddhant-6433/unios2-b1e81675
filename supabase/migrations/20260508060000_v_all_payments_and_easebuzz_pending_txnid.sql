-- ====================================================================
-- Phase 1 finance fixes:
--   1. v_all_payments view — Finance/FeeCollections/TransactionHistory
--      need a single query that surfaces BOTH lead_payments
--      (pre-admission token / application fees) AND post-admission
--      payments. Today they only read `payments`, so confirmed token
--      fees pre-AN are invisible (Diya Sharma's ₹5000 case). The
--      existing fee_ledger_payments link table already maps
--      lead_payments → fee_ledger correctly — there is no data bug,
--      only a query gap.
--
--   2. applications.pending_txnid — apply portal generates a unique
--      txnid at initiate but doesn't persist it. The reconcile button
--      reconstructs it incorrectly (no Date.now() suffix), so EaseBuzz
--      `transaction/v2/retrieve` always 404s. Persisting the original
--      txnid here lets reconciliation actually find the transaction.
-- ====================================================================

-- 1. ────────── pending_txnid for reliable manual reconcile ─────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS pending_txnid text;

CREATE INDEX IF NOT EXISTS idx_applications_pending_txnid
  ON public.applications (pending_txnid)
  WHERE pending_txnid IS NOT NULL;

COMMENT ON COLUMN public.applications.pending_txnid IS
  'EaseBuzz txnid stored at initiate so manual reconcile can hit transaction/v2/retrieve with the exact value (vs reconstructing it client-side, which lost the Date.now suffix and always 404''d).';

-- 2. ────────── Unified payments view for Finance UIs ──────────────
-- Two domains UNIONed:
--   (a) post-admission `payments` (cash/UPI/online entered by accountant)
--   (b) confirmed `lead_payments` (pre-admission gateway/cash/etc.)
-- Each row carries `source = 'student' | 'lead'` so the UI can render
-- a small chip indicating which ledger it came from.
--
-- security_invoker=true makes the view honour the caller's RLS on the
-- underlying tables (rather than running as the view owner). Both
-- payments and lead_payments policies already restrict to finance staff
-- and student-self, so the view inherits those rules cleanly.

DROP VIEW IF EXISTS public.v_all_payments;

CREATE VIEW public.v_all_payments WITH (security_invoker=true) AS
  SELECT
    'student'::text                      AS source,
    p.id                                 AS id,
    p.amount                             AS amount,
    p.payment_mode                       AS payment_mode,
    p.transaction_ref                    AS transaction_ref,
    p.receipt_no                         AS receipt_no,
    p.paid_at                            AS paid_at,
    p.recorded_by                        AS recorded_by,
    p.notes                              AS notes,
    p.student_id                         AS student_id,
    s.lead_id                            AS lead_id,
    NULL::text                           AS fee_type,
    p.fee_ledger_id                      AS fee_ledger_id,
    COALESCE(s.name, '')                 AS person_name,
    s.admission_no                       AS admission_no,
    s.pre_admission_no                   AS pre_admission_no,
    s.campus_id                          AS campus_id,
    p.created_at                         AS created_at
    FROM public.payments p
    LEFT JOIN public.students s ON s.id = p.student_id

  UNION ALL

  SELECT
    'lead'::text                         AS source,
    lp.id                                AS id,
    lp.amount                            AS amount,
    lp.payment_mode                      AS payment_mode,
    lp.transaction_ref                   AS transaction_ref,
    lp.receipt_no                        AS receipt_no,
    lp.payment_date                      AS paid_at,
    lp.recorded_by                       AS recorded_by,
    lp.notes                             AS notes,
    s.id                                 AS student_id,
    lp.lead_id                           AS lead_id,
    lp.type                              AS fee_type,
    NULL::uuid                           AS fee_ledger_id,
    COALESCE(s.name, l.name, '')         AS person_name,
    s.admission_no                       AS admission_no,
    s.pre_admission_no                   AS pre_admission_no,
    COALESCE(s.campus_id, l.campus_id)   AS campus_id,
    lp.created_at                        AS created_at
    FROM public.lead_payments lp
    LEFT JOIN public.leads l    ON l.id = lp.lead_id
    LEFT JOIN public.students s ON s.lead_id = lp.lead_id
   WHERE lp.status = 'confirmed';

GRANT SELECT ON public.v_all_payments TO authenticated;
GRANT SELECT ON public.v_all_payments TO service_role;

COMMENT ON VIEW public.v_all_payments IS
  'Single source of truth for "money received" across both pre-admission lead_payments and post-admission payments. Finance / FeeCollections / TransactionHistory UIs query this. Each row tagged source = student | lead.';
