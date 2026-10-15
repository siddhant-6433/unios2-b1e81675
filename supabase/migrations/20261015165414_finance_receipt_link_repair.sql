-- finance receipt link repair

-- One canonical, caller-RLS-scoped confirmed-payment read model for Finance
-- and student panels. Append columns so existing PostgREST clients retain the
-- current v_all_payments column order.
CREATE OR REPLACE VIEW public.v_all_payments WITH (security_invoker = true) AS
  SELECT
    'student'::text                      AS source,
    p.id                                 AS id,
    p.amount                             AS amount,
    p.payment_mode                      AS payment_mode,
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
    lfc.name                             AS fee_head,
    'confirmed'::text                    AS status,
    'student_fee'::text                  AS type,
    NULL::text                           AS receipt_url,
    NULL::uuid                           AS receipt_course_id,
    p.paid_at                            AS payment_date,
    NULL::text                           AS application_id,
    NULL::text                           AS bank_ref_num
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
    COALESCE(lp.student_id, s.id)        AS student_id,
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
    )                                    AS fee_head,
    lp.status                            AS status,
    lp.type                              AS type,
    lp.receipt_url                       AS receipt_url,
    lp.receipt_course_id                 AS receipt_course_id,
    lp.payment_date                      AS payment_date,
    lp.application_id                    AS application_id,
    lp.bank_ref_num                      AS bank_ref_num
    FROM public.lead_payments lp
    LEFT JOIN public.leads l      ON l.id = lp.lead_id
    LEFT JOIN LATERAL (
      SELECT st.*
        FROM public.students st
       WHERE st.id = lp.student_id
          OR (lp.student_id IS NULL AND lp.lead_id IS NOT NULL AND st.lead_id = lp.lead_id)
       ORDER BY (st.id = lp.student_id) DESC, st.created_at DESC
       LIMIT 1
    ) s ON true
    LEFT JOIN public.fee_codes fc ON fc.id = lp.fee_code_id
   WHERE lp.status = 'confirmed';

GRANT SELECT ON public.v_all_payments TO authenticated, service_role;

-- Stable keyset order for large histories. Null dates sort last in the view
-- query; the partial lead index matches the confirmed receipt collection.
CREATE INDEX IF NOT EXISTS idx_payments_paid_at_id_desc
  ON public.payments (paid_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lead_payments_confirmed_date_id_desc
  ON public.lead_payments (payment_date DESC NULLS LAST, id DESC)
  WHERE status = 'confirmed';

-- A receipt link repair changes one identity key only. A transaction-local
-- reason is consumed by the existing append-only lead_payments audit trigger.
CREATE OR REPLACE FUNCTION public.repair_confirmed_lead_payment_student_link(
  _payment_id uuid,
  _student_id uuid,
  _expected_student_id uuid,
  _application_id text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.lead_payments%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_application public.applications%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_payment_application text;
  v_direct_lead_match boolean;
  v_application_identity_match boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'finance:create') THEN
    RAISE EXCEPTION 'Finance permission required' USING ERRCODE = '42501';
  END IF;
  IF _payment_id IS NULL OR _student_id IS NULL THEN
    RAISE EXCEPTION 'Receipt and target student are required' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(_reason, ''))) < 8 THEN
    RAISE EXCEPTION 'Enter a reason of at least 8 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment
    FROM public.lead_payments lp
   WHERE lp.id = _payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed receipts can be linked' USING ERRCODE = '22023';
  END IF;
  IF v_payment.student_id IS DISTINCT FROM _expected_student_id THEN
    RAISE EXCEPTION 'Receipt link changed; reload and review it again' USING ERRCODE = '40001';
  END IF;
  IF v_payment.lead_id IS NULL THEN
    RAISE EXCEPTION 'Receipt has no lead to verify' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lead
    FROM public.leads l
   WHERE l.id = v_payment.lead_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt lead is no longer available' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.user_can_access_assigned_campus(auth.uid(), v_lead.campus_id)
  ) THEN
    RAISE EXCEPTION 'Receipt is outside your assigned campus' USING ERRCODE = '42501';
  END IF;

  v_payment_application := COALESCE(v_payment.application_id, v_lead.application_id);
  IF _application_id IS DISTINCT FROM v_payment_application THEN
    RAISE EXCEPTION 'Application changed; reload and review it again' USING ERRCODE = '40001';
  END IF;
  IF v_payment_application IS NOT NULL THEN
    SELECT * INTO v_application
      FROM public.applications a
     WHERE a.application_id = v_payment_application
       AND (
         a.lead_id = v_lead.id
         OR (a.lead_id IS NULL AND v_lead.application_id = a.application_id)
       )
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Application does not belong to this receipt lead' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_student
    FROM public.students s
   WHERE s.id = _student_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target student is no longer available' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.user_can_access_assigned_campus(auth.uid(), v_student.campus_id)
  ) THEN
    RAISE EXCEPTION 'Target student is outside your assigned campus' USING ERRCODE = '42501';
  END IF;
  IF v_lead.campus_id IS DISTINCT FROM v_student.campus_id THEN
    RAISE EXCEPTION 'Receipt and target student campuses do not match' USING ERRCODE = '22023';
  END IF;
  IF v_lead.course_id IS NOT NULL AND v_student.course_id IS DISTINCT FROM v_lead.course_id THEN
    RAISE EXCEPTION 'Receipt and target student courses do not match' USING ERRCODE = '22023';
  END IF;
  IF v_student.lead_id IS NOT NULL AND v_student.lead_id IS DISTINCT FROM v_lead.id THEN
    RAISE EXCEPTION 'Target student is already linked to a different lead' USING ERRCODE = '22023';
  END IF;
  IF v_lead.course_id IS NULL
     AND v_application.course_selections IS NOT NULL
     AND jsonb_typeof(v_application.course_selections) = 'array'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(v_application.course_selections) = 'array' THEN v_application.course_selections
           ELSE '[]'::jsonb
         END) AS selection
        WHERE NULLIF(selection->>'course_id', '') IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(v_application.course_selections) = 'array' THEN v_application.course_selections
           ELSE '[]'::jsonb
         END) AS selection
        WHERE lower(NULLIF(selection->>'course_id', '')) = v_student.course_id::text
     ) THEN
    RAISE EXCEPTION 'Receipt and target student courses do not match the application' USING ERRCODE = '22023';
  END IF;

  v_direct_lead_match := COALESCE(v_student.lead_id = v_lead.id, false);
  v_application_identity_match := COALESCE(v_payment_application IS NOT NULL
    AND NULLIF(trim(v_student.name), '') IS NOT NULL
    AND NULLIF(trim(v_application.full_name), '') IS NOT NULL
    AND lower(regexp_replace(trim(v_student.name), '\s+', ' ', 'g'))
        = lower(regexp_replace(trim(v_application.full_name), '\s+', ' ', 'g')), false);
  IF NOT v_direct_lead_match AND NOT v_application_identity_match THEN
    RAISE EXCEPTION 'Target student is not linked to the receipt lead or application' USING ERRCODE = '22023';
  END IF;

  -- Existing fee credits stay attached to their ledger rows. Refuse a link
  -- change that would make the receipt point at a different student than the
  -- student whose ledger already received its allocation; Finance must first
  -- unassign/reconcile that allocation through the normal ledger workflow.
  IF EXISTS (
    SELECT 1
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.lead_payment_id = v_payment.id
       AND fl.student_id IS DISTINCT FROM v_student.id
  ) THEN
    RAISE EXCEPTION 'Unassign this receipt from the current student fee ledger before changing the link' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.audit_reason', trim(_reason), true);
  UPDATE public.lead_payments lp
     SET student_id = _student_id
   WHERE lp.id = _payment_id
     AND lp.student_id IS NOT DISTINCT FROM _expected_student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt link changed; reload and review it again' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'payment_id', _payment_id,
    'student_id', _student_id,
    'receipt_no', v_payment.receipt_no,
    'application_id', v_payment_application
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text) TO authenticated;

-- Browser sessions must use the audited RPC for student-link repairs. Service
-- role remains available to trusted server-side payment reconciliation jobs.
REVOKE UPDATE ON public.lead_payments FROM authenticated;

-- Receipt-link-only updates do not change a consultant's financial inputs.
-- Skip payout recomputation for that narrow repair, while retaining the
-- existing recompute behavior for payment amount/status/lead changes.
CREATE OR REPLACE FUNCTION public.trg_recompute_consultant_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.lead_id IS NOT NULL THEN
      PERFORM public.recompute_consultant_payout(OLD.lead_id);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.student_id IS DISTINCT FROM NEW.student_id
     AND (to_jsonb(OLD) - 'student_id') = (to_jsonb(NEW) - 'student_id') THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN
    PERFORM public.recompute_consultant_payout(NEW.lead_id);
  END IF;
  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';
