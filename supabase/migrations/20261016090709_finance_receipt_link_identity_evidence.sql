-- finance receipt link identity evidence

-- Keep the audited repair reachable only through the explicit Finance review flow.
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
AS $legacy$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'finance:create') THEN
    RAISE EXCEPTION 'Finance permission required' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'This receipt review screen is out of date. Refresh Finance and review the receipt again.'
    USING ERRCODE = '40001';
END;
$legacy$;

REVOKE ALL ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.repair_confirmed_lead_payment_student_link(
  _payment_id uuid,
  _student_id uuid,
  _expected_student_id uuid,
  _application_id text,
  _reason text,
  _identity_confirmed boolean
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
  v_initial_student_id uuid;
  v_initial_lead_id uuid;
  v_lock_student_id uuid;
  v_direct_lead_match boolean;
  v_application_identity_match boolean;
  v_application_profile_match boolean;
  v_application_name text;
  v_student_name text;
  v_application_father_name text;
  v_application_mother_name text;
  v_student_father_name text;
  v_student_mother_name text;
  v_profile_candidate_count bigint;
  v_direct_lead_candidate_count bigint;
  v_identity_details_conflict boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'finance:create') THEN
    RAISE EXCEPTION 'Finance permission required' USING ERRCODE = '42501';
  END IF;
  IF _payment_id IS NULL OR _student_id IS NULL THEN
    RAISE EXCEPTION 'Receipt and target student are required' USING ERRCODE = '22023';
  END IF;
  IF _identity_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirm the receipt and student identity before linking' USING ERRCODE = '22023';
  END IF;
  IF length(trim(COALESCE(_reason, ''))) < 8 THEN
    RAISE EXCEPTION 'Enter a reason of at least 8 characters' USING ERRCODE = '22023';
  END IF;

  -- Fee provisioners take the same student advisory lock before they allocate
  -- a lead payment to a fee ledger. Acquire every current candidate lock in a
  -- stable order before locking the payment row, preventing allocation to the
  -- former student between the allocation check and this relink.
  SELECT lp.student_id, lp.lead_id
    INTO v_initial_student_id, v_initial_lead_id
    FROM public.lead_payments lp
   WHERE lp.id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_lock_student_id IN
    SELECT candidates.student_id
      FROM (
        SELECT _student_id AS student_id
        UNION
        SELECT v_initial_student_id
        UNION
        SELECT s.id
          FROM public.students s
         WHERE s.lead_id = v_initial_lead_id
        UNION
        SELECT fl.student_id
          FROM public.fee_ledger_payments flp
          JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
         WHERE flp.lead_payment_id = _payment_id
      ) AS candidates
     WHERE candidates.student_id IS NOT NULL
     ORDER BY candidates.student_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('student:' || v_lock_student_id::text, 1)
    );
  END LOOP;

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
  IF v_payment.lead_id IS DISTINCT FROM v_initial_lead_id THEN
    RAISE EXCEPTION 'Receipt lead changed; reload and review it again' USING ERRCODE = '40001';
  END IF;
  IF v_payment.lead_id IS NULL THEN
    RAISE EXCEPTION 'Receipt has no lead to verify' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lead
    FROM public.leads l
   WHERE l.id = v_payment.lead_id
   FOR UPDATE;
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
     AND s.archived_at IS NULL
     AND s.deleted_at IS NULL
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

  v_application_name := lower(regexp_replace(trim(COALESCE(v_application.full_name, '')), '\s+', ' ', 'g'));
  v_student_name := lower(regexp_replace(trim(COALESCE(v_student.name, '')), '\s+', ' ', 'g'));
  v_application_father_name := lower(regexp_replace(trim(COALESCE(
    NULLIF(btrim(v_application.father->>'name'), ''),
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(v_application.father->>'first_name'), ''), NULLIF(btrim(v_application.father->>'last_name'), ''))), '')
  )), '\s+', ' ', 'g'));
  v_application_mother_name := lower(regexp_replace(trim(COALESCE(
    NULLIF(btrim(v_application.mother->>'name'), ''),
    NULLIF(btrim(concat_ws(' ', NULLIF(btrim(v_application.mother->>'first_name'), ''), NULLIF(btrim(v_application.mother->>'last_name'), ''))), '')
  )), '\s+', ' ', 'g'));
  v_student_father_name := lower(regexp_replace(trim(COALESCE(v_student.father_name, '')), '\s+', ' ', 'g'));
  v_student_mother_name := lower(regexp_replace(trim(COALESCE(v_student.mother_name, '')), '\s+', ' ', 'g'));

  v_identity_details_conflict :=
    (v_application_name <> ''
      AND v_student_name <> v_application_name
      AND left(v_student_name, length(v_application_name) + 1) <> v_application_name || ' ')
    OR (v_application.dob IS NOT NULL AND v_student.dob IS NOT NULL AND v_application.dob <> v_student.dob)
    OR (v_application_father_name <> '' AND v_student_father_name <> '' AND v_application_father_name <> v_student_father_name)
    OR (v_application_mother_name <> '' AND v_student_mother_name <> '' AND v_application_mother_name <> v_student_mother_name);

  v_direct_lead_match := COALESCE(v_student.lead_id = v_lead.id, false);
  v_application_identity_match := v_payment_application IS NOT NULL
    AND v_application_name <> ''
    AND v_student_name = v_application_name
    AND NOT (
      (v_application.dob IS NOT NULL AND v_student.dob IS NOT NULL AND v_application.dob <> v_student.dob)
      OR (v_application_father_name <> '' AND v_student_father_name <> '' AND v_application_father_name <> v_student_father_name)
      OR (v_application_mother_name <> '' AND v_student_mother_name <> '' AND v_application_mother_name <> v_student_mother_name)
    );
  v_application_profile_match := v_payment_application IS NOT NULL
    AND v_application_name <> ''
    AND left(v_student_name, length(v_application_name) + 1) = v_application_name || ' '
    AND v_application.dob IS NOT NULL
    AND v_student.dob = v_application.dob
    AND (
      (v_application_father_name <> '' AND v_student_father_name = v_application_father_name)
      OR (v_application_mother_name <> '' AND v_student_mother_name = v_application_mother_name)
    )
    AND NOT (
      (v_application_father_name <> '' AND v_student_father_name <> '' AND v_application_father_name <> v_student_father_name)
      OR (v_application_mother_name <> '' AND v_student_mother_name <> '' AND v_application_mother_name <> v_student_mother_name)
    );

  -- Lead-based fee provisioning still selects its student by lead_id. A
  -- profile-only receipt match must not point payments at a different student
  -- while that lead is already attached to another active student.
  IF NOT v_direct_lead_match AND EXISTS (
    SELECT 1
      FROM public.students existing
     WHERE existing.lead_id = v_lead.id
       AND existing.archived_at IS NULL
       AND existing.deleted_at IS NULL
       AND existing.id IS DISTINCT FROM v_student.id
  ) THEN
    RAISE EXCEPTION 'Receipt lead is linked to a different active student; reconcile the lead and student records before repairing this receipt' USING ERRCODE = '22023';
  END IF;

  IF v_direct_lead_match THEN
    SELECT count(*) INTO v_direct_lead_candidate_count
      FROM public.students candidate
     WHERE candidate.lead_id = v_lead.id
       AND candidate.archived_at IS NULL
       AND candidate.deleted_at IS NULL;
    IF v_direct_lead_candidate_count <> 1 THEN
      RAISE EXCEPTION 'Receipt lead is linked to multiple active students; resolve the duplicate student records before linking' USING ERRCODE = '22023';
    END IF;
    IF v_identity_details_conflict THEN
      RAISE EXCEPTION 'Available application identity details conflict with the target student' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NOT v_direct_lead_match AND NOT v_application_identity_match AND NOT v_application_profile_match THEN
    RAISE EXCEPTION 'Target student is not linked to the receipt lead or supported by the application identity' USING ERRCODE = '22023';
  END IF;

  IF NOT v_direct_lead_match THEN
    SELECT count(*) INTO v_profile_candidate_count
      FROM (
        SELECT
          lower(regexp_replace(trim(COALESCE(candidate.name, '')), '\s+', ' ', 'g')) AS name,
          candidate.dob,
          lower(regexp_replace(trim(COALESCE(candidate.father_name, '')), '\s+', ' ', 'g')) AS father_name,
          lower(regexp_replace(trim(COALESCE(candidate.mother_name, '')), '\s+', ' ', 'g')) AS mother_name
          FROM public.students candidate
         WHERE candidate.campus_id IS NOT DISTINCT FROM v_student.campus_id
           AND candidate.course_id IS NOT DISTINCT FROM v_student.course_id
           AND candidate.archived_at IS NULL
           AND candidate.deleted_at IS NULL
      ) AS candidate
     WHERE NOT (
       (v_application.dob IS NOT NULL AND candidate.dob IS NOT NULL AND v_application.dob <> candidate.dob)
       OR (v_application_father_name <> '' AND candidate.father_name <> '' AND v_application_father_name <> candidate.father_name)
       OR (v_application_mother_name <> '' AND candidate.mother_name <> '' AND v_application_mother_name <> candidate.mother_name)
     )
       AND (
         candidate.name = v_application_name
         OR (
           left(candidate.name, length(v_application_name) + 1) = v_application_name || ' '
           AND v_application.dob IS NOT NULL
           AND candidate.dob = v_application.dob
           AND (
             (v_application_father_name <> '' AND candidate.father_name = v_application_father_name)
             OR (v_application_mother_name <> '' AND candidate.mother_name = v_application_mother_name)
           )
         )
       );
    IF v_profile_candidate_count <> 1 THEN
      RAISE EXCEPTION 'Application identity matches multiple students or cannot be uniquely verified; resolve the student records before linking' USING ERRCODE = '22023';
    END IF;
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

REVOKE ALL ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_confirmed_lead_payment_student_link(uuid, uuid, uuid, text, text, boolean) TO authenticated;

-- Student-link-only repairs do not change the inputs to staff incentive
-- accrual/reversal. Limit updates that fire this trigger to its financial
-- inputs so relinking cannot create a new accrual as a side effect.
DROP TRIGGER IF EXISTS trg_incentive_on_payment ON public.lead_payments;
CREATE TRIGGER trg_incentive_on_payment
  AFTER INSERT OR UPDATE OF status, amount, lead_id, type, payment_date ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_incentive_on_payment();

-- Student relinking does not change the consultant payout inputs either.
DROP TRIGGER IF EXISTS lead_payments_consultant_payout ON public.lead_payments;
CREATE TRIGGER lead_payments_consultant_payout
  AFTER INSERT OR DELETE OR UPDATE OF status, amount, lead_id ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_consultant_payout();

-- Allocation reads a payment before taking the same student lock used by the
-- repair RPC. If a repair wins that lock, reject the stale allocation snapshot
-- after reloading the payment row; never credit a ledger using the old student.
CREATE OR REPLACE FUNCTION public.apply_fee_payment_allocations(
  _lead_payment_id uuid,
  _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $allocation$
DECLARE
  v_payment public.lead_payments%ROWTYPE;
  v_allocation record;
  v_row public.fee_ledger%ROWTYPE;
  v_student_id uuid;
  v_initial_student_id uuid;
  v_initial_lead_id uuid;
  v_locked_student_id uuid;
  v_lead_student_count bigint;
  v_total numeric := 0;
  v_concession_total numeric := 0;
  v_existing numeric := 0;
  v_existing_concession numeric := 0;
  v_rows int := 0;
  v_applied int := 0;
BEGIN
  IF _lead_payment_id IS NULL OR jsonb_typeof(_allocations) <> 'array' THEN
    RAISE EXCEPTION 'A payment id and allocation array are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_payment
    FROM public.lead_payments
   WHERE id = _lead_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % was not found', _lead_payment_id USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Payment % is not pending or confirmed', _lead_payment_id USING ERRCODE = '23514';
  END IF;

  v_initial_student_id := v_payment.student_id;
  v_initial_lead_id := v_payment.lead_id;
  v_student_id := v_initial_student_id;
  IF v_student_id IS NULL AND v_initial_lead_id IS NOT NULL THEN
    SELECT count(*) INTO v_lead_student_count
      FROM public.students
     WHERE lead_id = v_initial_lead_id
       AND archived_at IS NULL
       AND deleted_at IS NULL;
    IF v_lead_student_count <> 1 THEN
      RAISE EXCEPTION 'Payment % requires exactly one active student linked to its lead before allocation', _lead_payment_id USING ERRCODE = '23514';
    END IF;
    SELECT id INTO v_student_id
      FROM public.students
     WHERE lead_id = v_initial_lead_id
       AND archived_at IS NULL
       AND deleted_at IS NULL
     ORDER BY id
     LIMIT 1;
  END IF;
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Payment % is not linked to a student', _lead_payment_id USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('student:' || v_student_id::text, 1));

  SELECT * INTO v_payment
    FROM public.lead_payments
   WHERE id = _lead_payment_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % was not found', _lead_payment_id USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.student_id IS DISTINCT FROM v_initial_student_id
     OR v_payment.lead_id IS DISTINCT FROM v_initial_lead_id THEN
    RAISE EXCEPTION 'Payment link changed while allocation was starting; retry the allocation' USING ERRCODE = '40001';
  END IF;
  IF v_payment.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Payment status changed while allocation was starting; review the payment before retrying' USING ERRCODE = '23514';
  END IF;
  SELECT s.id INTO v_locked_student_id
    FROM public.students s
   WHERE s.id = v_student_id
     AND (v_initial_student_id IS NOT NULL OR s.lead_id = v_initial_lead_id)
     AND s.archived_at IS NULL
     AND s.deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment student changed while allocation was starting; retry the allocation' USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(concession_amount), 0)
    INTO v_existing, v_existing_concession
    FROM public.fee_ledger_payments
   WHERE lead_payment_id = _lead_payment_id;

  FOR v_allocation IN
    SELECT fee_ledger_id,
           SUM(amount)::numeric AS amount,
           COALESCE(SUM(concession_amount), 0)::numeric AS concession_amount,
           MAX(notes) AS notes
      FROM jsonb_to_recordset(_allocations) AS x(
        fee_ledger_id uuid,
        amount numeric,
        concession_amount numeric,
        notes text
      )
     GROUP BY fee_ledger_id
     ORDER BY fee_ledger_id
  LOOP
    IF v_allocation.fee_ledger_id IS NULL
       OR v_allocation.amount IS NULL
       OR v_allocation.amount < 0
       OR v_allocation.concession_amount < 0
       OR v_allocation.amount + v_allocation.concession_amount <= 0 THEN
      RAISE EXCEPTION 'Invalid allocation for payment %', _lead_payment_id USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_row
      FROM public.fee_ledger
     WHERE id = v_allocation.fee_ledger_id
       AND student_id = v_student_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ledger row % does not belong to payment student', v_allocation.fee_ledger_id
        USING ERRCODE = '23514';
    END IF;

    IF v_row.total_amount - v_row.paid_amount - v_row.concession
       < v_allocation.amount + v_allocation.concession_amount - 0.009 THEN
      RAISE EXCEPTION 'Allocation exceeds remaining balance for ledger row %', v_row.id
        USING ERRCODE = '23514';
    END IF;

    v_total := v_total + v_allocation.amount;
    v_concession_total := v_concession_total + v_allocation.concession_amount;
    v_rows := v_rows + 1;

    UPDATE public.fee_ledger
       SET paid_amount = paid_amount + v_allocation.amount,
           concession = concession + v_allocation.concession_amount,
           status = CASE
             WHEN paid_amount + v_allocation.amount + concession + v_allocation.concession_amount
                  >= total_amount - 0.009 THEN 'paid'
             WHEN due_date < current_date THEN 'overdue'
             ELSE 'due'
           END,
           updated_at = now()
     WHERE id = v_row.id;

    INSERT INTO public.fee_ledger_payments (
      fee_ledger_id, lead_payment_id, amount, concession_amount, notes
    ) VALUES (
      v_row.id, _lead_payment_id, v_allocation.amount,
      v_allocation.concession_amount, v_allocation.notes
    );
    v_applied := v_applied + 1;
  END LOOP;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'At least one positive ledger allocation is required' USING ERRCODE = '23514';
  END IF;
  IF v_existing + v_total > v_payment.amount + 0.009 THEN
    RAISE EXCEPTION 'Payment % would be over-applied: already %, adding %, receipt amount %',
      _lead_payment_id, v_existing, v_total, v_payment.amount USING ERRCODE = '23514';
  END IF;
  IF v_existing_concession + v_concession_total > COALESCE(v_payment.concession_amount, 0) + 0.009 THEN
    RAISE EXCEPTION 'Payment % would exceed its recorded concession amount', _lead_payment_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.lead_payments
     SET applied_to_ledger = (v_existing + v_total >= v_payment.amount - 0.009)
   WHERE id = _lead_payment_id;

  RETURN jsonb_build_object(
    'payment_id', _lead_payment_id,
    'allocations_applied', v_applied,
    'total_applied', v_total,
    'total_concession', v_concession_total,
    'complete', (v_existing + v_total >= v_payment.amount - 0.009)
  );
END;
$allocation$;

REVOKE ALL ON FUNCTION public.apply_fee_payment_allocations(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_fee_payment_allocations(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
