-- Provision the fee ledger at PAN, not only at AN.
--
-- Money is routinely collected before the application and sometimes before the
-- offer letter. Today trg_auto_provision_fees_on_admission fires only on
-- admission_no, so a pre-admitted student (PAN issued, no AN yet) gets no
-- ledger at all and their confirmed payments sit on the lead with nowhere to
-- post. Five students are in exactly that state, holding Rs 1,30,050.
--
-- Firing on pre_admission_no as well provisions the structure and lets
-- provision_student_fees() apply the credits as soon as the student record
-- exists. It stays idempotent: the provisioner only inserts heads that are
-- missing and only creates credit up to (confirmed payments - already paid).
--
-- Guard shipped with it: fn_recompute_late_fees() has no student-status filter,
-- so provisioning earlier would start late-fee accrual on pre-admitted
-- candidates who may never join. Late fees are limited to active students here.
-- No pre_admitted student currently carries a LATE-FEE row, so nothing changes
-- retroactively.

CREATE OR REPLACE FUNCTION public.auto_provision_fees_on_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url  text;
  v_key  text;
  v_became_numbered boolean;
BEGIN
  -- Fire the first time EITHER number is stamped: PAN for a pre-admission,
  -- AN for a full admission.
  v_became_numbered :=
       (NEW.pre_admission_no IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.pre_admission_no IS NULL))
    OR (NEW.admission_no     IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.admission_no     IS NULL));

  IF NOT v_became_numbered THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[auto_provision_fees] _app_config missing supabase_url or service_role_key; skipping auto-provision for student %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/provision-student-fees',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('student_id', NEW.id)
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_provision_fees_on_admission ON public.students;
CREATE TRIGGER trg_auto_provision_fees_on_admission
AFTER INSERT OR UPDATE OF admission_no, pre_admission_no ON public.students
FOR EACH ROW
WHEN (NEW.admission_no IS NOT NULL OR NEW.pre_admission_no IS NOT NULL)
EXECUTE FUNCTION public.auto_provision_fees_on_admission();

-- Linking a lead to an existing student is the other moment the money can
-- finally be placed: re-run provisioning and re-sync waivers.
CREATE OR REPLACE FUNCTION public.tg_provision_on_lead_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL AND OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
    PERFORM public.provision_student_fees(NEW.lead_id);
    PERFORM public.sync_fee_ledger_concessions(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_provision_on_lead_link ON public.students;
CREATE TRIGGER trg_provision_on_lead_link
AFTER UPDATE OF lead_id ON public.students
FOR EACH ROW EXECUTE FUNCTION public.tg_provision_on_lead_link();

-- Late fees: active students only. Without this, provisioning at PAN would
-- start penalising pre-admitted candidates who have not joined (and may never).
CREATE OR REPLACE FUNCTION public.fn_recompute_late_fees(_student_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      AND s.status = 'active'
      AND s.deleted_at IS NULL
      AND (fl.late_fee_config IS NOT NULL OR lfp.id IS NOT NULL)
      AND (_student_id IS NULL OR fl.student_id = _student_id)
  LOOP
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
      v_grace := COALESCE((v_cfg->>'grace_days')::int, 0);
      v_cap   := NULLIF(v_cfg->>'max_cap', '')::numeric;
      v_days  := GREATEST(0, (v_eff - rec.due_date) - v_grace);
      IF v_days <= 0 THEN
        v_amt := 0;
      ELSIF (v_cfg->>'penalty_type') = 'daily' THEN
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0) * v_days, 2);
      ELSIF (v_cfg->>'penalty_type') = 'percentage' THEN
        v_amt := ROUND(GREATEST(rec.balance, 0) * COALESCE((v_cfg->>'penalty_amount')::numeric, 0) / 100, 2);
      ELSE
        v_amt := ROUND(COALESCE((v_cfg->>'penalty_amount')::numeric, 0), 2);
      END IF;
      IF v_cap IS NOT NULL THEN v_amt := LEAST(v_amt, v_cap); END IF;
    ELSE
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
