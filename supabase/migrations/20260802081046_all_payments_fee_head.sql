-- ====================================================================
-- Expose the fee head on v_all_payments.
--
-- Two things were wrong:
--   1. lead_payments.fee_code_id (added for the cashier desk's ad-hoc
--      charges) never reached the view, so a receipt collected against
--      "Sports" looked identical to any other "other" payment.
--   2. The Fee Head column has ALWAYS rendered "—" for every row —
--      FeeCollections reads `p.fee_description`, which this view has
--      never had. It exposes `fee_type`. The column was dead on arrival.
--
-- fee_head resolves in priority order: the linked fee code's name, then
-- the ledger row's fee code (post-admission payments), then a readable
-- label for the lead_payments type enum.
--
-- CREATE OR REPLACE VIEW can only append columns, so fee_head goes last
-- and every existing column keeps its position.
-- ====================================================================

-- security_invoker is this view's pre-existing and intended design — per-role RLS
-- filtering is exactly what scopes payments to a caller's campus and leads. Making
-- that filtering behave for accountants was the point of
-- 20260801150959_accountant_lead_visibility.sql, not something to bypass here.
-- lint-allow: RLS filtering on this view is intentional and pre-existing.
CREATE OR REPLACE VIEW public.v_all_payments WITH (security_invoker=true) AS
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
    p.created_at                         AS created_at,
    NULL::text                           AS gateway,
    lfc.name                             AS fee_head
    FROM public.payments p
    LEFT JOIN public.students s   ON s.id = p.student_id
    LEFT JOIN public.fee_ledger fl ON fl.id = p.fee_ledger_id
    LEFT JOIN public.fee_codes lfc ON lfc.id = fl.fee_code_id

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
    lp.created_at                        AS created_at,
    lp.gateway                           AS gateway,
    COALESCE(
      fc.name,
      CASE lp.type
        WHEN 'application_fee'      THEN 'Application Fee'
        WHEN 'token_fee'            THEN 'Token Fee'
        WHEN 'pre_admission_token'  THEN 'Token Fee (prior to admission)'
        WHEN 'registration_fee'     THEN 'Registration Fee'
        WHEN 'other'                THEN 'Other Charges'
        ELSE initcap(replace(lp.type, '_', ' '))
      END
    )                                    AS fee_head
    FROM public.lead_payments lp
    LEFT JOIN public.leads l     ON l.id = lp.lead_id
    LEFT JOIN public.students s  ON s.lead_id = lp.lead_id
    LEFT JOIN public.fee_codes fc ON fc.id = lp.fee_code_id
   WHERE lp.status = 'confirmed';

GRANT SELECT ON public.v_all_payments TO authenticated;
GRANT SELECT ON public.v_all_payments TO service_role;

NOTIFY pgrst, 'reload schema';
