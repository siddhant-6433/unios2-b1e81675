-- Custom fee heads (meal, transport, ad-hoc), per-student / bulk fee assignment,
-- and a per-fee-head late-fine override. See add_custom_fee below.

-- 1. Widen the fee_codes category list so a "meal" add-on head is first-class
--    (transport/other already exist). Idempotent: drop + re-add the CHECK.
ALTER TABLE public.fee_codes DROP CONSTRAINT IF EXISTS fee_codes_category_check;
ALTER TABLE public.fee_codes ADD CONSTRAINT fee_codes_category_check
  CHECK (category IN ('tuition','hostel','transport','lab','library','exam',
                      'enrollment','token','late_fee','meal','other'));

-- 2. Per-head late-fine override. One nullable jsonb column carries
--    {grace_days, penalty_type, penalty_amount, max_cap} on both the template
--    item and the posted ledger row, so a custom fee can set its own late fine
--    independent of the per-fee_structure late_fee_policies row.
ALTER TABLE public.fee_ledger          ADD COLUMN IF NOT EXISTS late_fee_config jsonb;
ALTER TABLE public.fee_structure_items ADD COLUMN IF NOT EXISTS late_fee_config jsonb;

-- 3. Teach fn_recompute_late_fees to honor a row's own late_fee_config. Rows
--    with per-row config are processed even without a fee_structure policy;
--    rows without config fall back to the existing beacon per-structure policy
--    (boarding-tier daily rate). Same idempotent upsert of one LATE-FEE row
--    per overdue term, same payment-date freeze.
CREATE OR REPLACE FUNCTION public.fn_recompute_late_fees(_student_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_late uuid; rec record; v_rate numeric; v_eff date; v_days int; v_amt numeric;
  v_late_term text; v_existing uuid; v_cfg jsonb; v_grace int; v_cap numeric;
BEGIN
  SELECT id INTO v_late FROM public.fee_codes WHERE code = 'LATE-FEE' LIMIT 1;
  IF v_late IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT fl.id AS ledger_id, fl.student_id, fl.term, fl.due_date, fl.updated_at,
           fl.late_fee_config AS cfg,
           (fl.total_amount - fl.concession - fl.paid_amount) AS balance,
           lfp.penalty_amount, lfp.boarding_penalty_amount, lfp.boarding_fee_codes,
           COALESCE(lfp.grace_period_days, 0) AS grace, lfp.max_penalty_cap
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    JOIN public.students s ON s.id = fl.student_id
    LEFT JOIN public.fee_structures fs
        ON fs.course_id = s.course_id AND fs.session_id = s.session_id
       AND fs.version = s.fee_structure_version
    LEFT JOIN public.late_fee_policies lfp
        ON lfp.fee_structure_id = fs.id AND lfp.is_active = true
       AND fc.category = ANY (lfp.applies_to_categories)
    WHERE fl.fee_code_id <> v_late
      AND fl.due_date IS NOT NULL
      AND (fl.late_fee_config IS NOT NULL OR lfp.id IS NOT NULL)
      AND (_student_id IS NULL OR fl.student_id = _student_id)
  LOOP
    -- effective date: unpaid → today; paid → payment_date of the linked receipt(s),
    -- else the ledger's last-updated date. (Payment-date freeze; shared by both paths.)
    IF rec.balance <= 0 THEN
      v_eff := COALESCE(
        (SELECT MAX(lp.payment_date)
           FROM public.fee_ledger_payments flp
           JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
          WHERE flp.fee_ledger_id = rec.ledger_id
            AND lp.status = 'confirmed' AND lp.payment_date IS NOT NULL),
        rec.updated_at::date);
    ELSE
      v_eff := CURRENT_DATE;
    END IF;

    v_cfg := rec.cfg;
    IF v_cfg IS NOT NULL THEN
      -- Per-head override.
      v_grace := COALESCE((v_cfg->>'grace_days')::int, 0);
      v_cap   := NULLIF(v_cfg->>'max_cap', '')::numeric;
      v_days  := GREATEST(0, (v_eff - rec.due_date) - v_grace);
      IF v_days <= 0 THEN
        v_amt := 0;
      ELSIF (v_cfg->>'penalty_type') = 'daily' THEN
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0) * v_days, 2);
      ELSIF (v_cfg->>'penalty_type') = 'percentage' THEN
        v_amt := ROUND(GREATEST(rec.balance, 0) * COALESCE((v_cfg->>'penalty_amount')::numeric, 0) / 100, 2);
      ELSE -- 'flat' (default): charged once when overdue
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0), 2);
      END IF;
      IF v_cap IS NOT NULL THEN v_amt := LEAST(v_amt, v_cap); END IF;
    ELSE
      -- Existing per-structure beacon policy: rate by boarding tier, daily basis.
      IF EXISTS (
        SELECT 1 FROM public.fee_ledger b JOIN public.fee_codes bc ON bc.id = b.fee_code_id
         WHERE b.student_id = rec.student_id AND bc.code = ANY (rec.boarding_fee_codes)
      ) THEN
        v_rate := rec.boarding_penalty_amount;
      ELSE
        v_rate := rec.penalty_amount;
      END IF;
      v_days := GREATEST(0, (v_eff - rec.due_date) - rec.grace);
      v_amt  := ROUND(COALESCE(v_rate, 0) * v_days, 2);
      IF rec.max_penalty_cap IS NOT NULL THEN v_amt := LEAST(v_amt, rec.max_penalty_cap); END IF;
    END IF;

    v_late_term := 'late_' || rec.term;
    SELECT id INTO v_existing FROM public.fee_ledger
     WHERE student_id = rec.student_id AND term = v_late_term AND fee_code_id = v_late
     LIMIT 1;

    IF v_amt > 0 THEN
      IF v_existing IS NULL THEN
        INSERT INTO public.fee_ledger
          (student_id, fee_code_id, fee_structure_item_id, term, total_amount, due_date, status)
        VALUES (rec.student_id, v_late, NULL, v_late_term, v_amt, CURRENT_DATE, 'due');
      ELSE
        UPDATE public.fee_ledger SET total_amount = v_amt, updated_at = now()
         WHERE id = v_existing AND paid_amount = 0;
      END IF;
    ELSE
      DELETE FROM public.fee_ledger WHERE id = v_existing AND paid_amount = 0;
    END IF;
  END LOOP;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_recompute_late_fees(uuid) TO authenticated, service_role;

-- 4. add_custom_fee: the one entry point behind both the per-student "Add Fee"
--    dialog and the bulk tool. The frontend expands frequency/months into a flat
--    list of installments [{term, amount, due_date}]; this function just persists
--    them, creating the fee head if new, in either one-off or template mode.
CREATE OR REPLACE FUNCTION public.add_custom_fee(
  p_mode            text,               -- 'one_off' | 'template'
  p_student_ids     uuid[]  DEFAULT NULL,
  p_course_id       uuid    DEFAULT NULL,
  p_session_id      uuid    DEFAULT NULL,
  p_fee_code_id     uuid    DEFAULT NULL,
  p_new_code        text    DEFAULT NULL,
  p_new_name        text    DEFAULT NULL,
  p_new_category    text    DEFAULT NULL,
  p_installments    jsonb   DEFAULT '[]'::jsonb,
  p_late_fee_config jsonb   DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_code_id     uuid;
  v_struct_id   uuid;
  v_item_id     uuid;
  v_rows        int := 0;
  v_rows_total  int := 0;
  v_students    uuid[];
  inst          jsonb;
  v_term        text;
  v_amount      numeric;
  v_due         date;
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage fees';
  END IF;
  IF p_mode NOT IN ('one_off','template') THEN
    RAISE EXCEPTION 'Invalid mode %', p_mode;
  END IF;
  IF p_installments IS NULL OR jsonb_array_length(p_installments) = 0 THEN
    RAISE EXCEPTION 'At least one installment is required';
  END IF;

  -- Resolve or create the fee head.
  IF p_fee_code_id IS NOT NULL THEN
    v_code_id := p_fee_code_id;
  ELSE
    IF p_new_code IS NULL OR p_new_name IS NULL OR p_new_category IS NULL THEN
      RAISE EXCEPTION 'New fee head requires code, name and category';
    END IF;
    INSERT INTO public.fee_codes (code, name, category, is_recurring)
    VALUES (upper(p_new_code), p_new_name, p_new_category, true)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_code_id;
  END IF;

  -- Resolve target students + (template) the structure the item hangs off.
  IF p_mode = 'template' THEN
    IF p_course_id IS NULL OR p_session_id IS NULL THEN
      RAISE EXCEPTION 'Template mode requires course_id and session_id';
    END IF;
    SELECT id INTO v_struct_id FROM public.fee_structures
     WHERE course_id = p_course_id AND session_id = p_session_id AND is_active = true
     ORDER BY created_at DESC LIMIT 1;
    IF v_struct_id IS NULL THEN
      RAISE EXCEPTION 'No active fee structure for this course + session';
    END IF;
    SELECT array_agg(id) INTO v_students FROM public.students
     WHERE course_id = p_course_id AND session_id = p_session_id;
  ELSE
    IF p_student_ids IS NULL OR array_length(p_student_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'One-off mode requires at least one student';
    END IF;
    v_students := p_student_ids;
  END IF;

  -- Persist each installment.
  FOR inst IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    v_term   := inst->>'term';
    v_amount := (inst->>'amount')::numeric;
    v_due    := NULLIF(inst->>'due_date', '')::date;
    IF v_term IS NULL OR v_amount IS NULL OR v_amount < 0 THEN
      RAISE EXCEPTION 'Each installment needs a term and a non-negative amount';
    END IF;

    -- Template mode: create the reusable template item so FUTURE admissions
    -- inherit the head via the provisioners (which copy late_fee_config).
    v_item_id := NULL;
    IF p_mode = 'template' THEN
      INSERT INTO public.fee_structure_items
        (fee_structure_id, fee_code_id, term, amount, due_day, due_date, late_fee_config)
      VALUES (v_struct_id, v_code_id, v_term, v_amount, 10, v_due, p_late_fee_config)
      RETURNING id INTO v_item_id;
    END IF;

    -- Post one ledger row per current student, skipping any that already have
    -- this (fee_code, term) so re-runs are idempotent.
    INSERT INTO public.fee_ledger
      (student_id, fee_code_id, fee_structure_item_id, term, total_amount,
       due_date, status, late_fee_config)
    SELECT sid, v_code_id, v_item_id, v_term, v_amount, v_due, 'due', p_late_fee_config
      FROM unnest(v_students) AS sid
     WHERE NOT EXISTS (
       SELECT 1 FROM public.fee_ledger fl
        WHERE fl.student_id = sid AND fl.fee_code_id = v_code_id AND fl.term = v_term
     );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_rows_total := v_rows_total + v_rows;
  END LOOP;

  RETURN jsonb_build_object(
    'fee_code_id',       v_code_id,
    'rows_created',      v_rows_total,
    'students_affected', COALESCE(array_length(v_students, 1), 0)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.add_custom_fee(text, uuid[], uuid, uuid, uuid, text, text, text, jsonb, jsonb)
  TO authenticated, service_role;
