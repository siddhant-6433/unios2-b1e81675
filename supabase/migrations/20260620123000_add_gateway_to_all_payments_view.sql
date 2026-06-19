-- Surface the payment gateway in unified finance payment views.
-- Native post-admission payments do not currently store gateway metadata, so
-- they expose NULL; lead_payments rows carry the gateway slug.

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
    NULL::text                           AS gateway
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
    lp.created_at                        AS created_at,
    lp.gateway                           AS gateway
    FROM public.lead_payments lp
    LEFT JOIN public.leads l    ON l.id = lp.lead_id
    LEFT JOIN public.students s ON s.lead_id = lp.lead_id
   WHERE lp.status = 'confirmed';

GRANT SELECT ON public.v_all_payments TO authenticated;
GRANT SELECT ON public.v_all_payments TO service_role;

