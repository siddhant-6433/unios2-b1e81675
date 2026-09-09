-- Keep payment-sourced concessions (lump-sum Year-1 5%, student-portal
-- one-time waiver) on fee_ledger.concession. sync_fee_ledger_concessions
-- previously reset every row to manual concessions + offer waivers only,
-- which wiped lead_payments / fee_ledger_payments.concession_amount after
-- provisioning or any later waiver edit.
--
-- Also: apply a cashier-recorded lump-sum onto the Year-1 tuition rows
-- named by the payment's allocations, then re-sync.

CREATE OR REPLACE FUNCTION public.sync_fee_ledger_concessions(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead     uuid;
  v_offer    uuid;
  v_term     text;
  v_category text;
  v_wamt     numeric;
  v_cap_sum  numeric;
  v_capped   numeric;
  v_alloc    numeric;
  v_cnt      int;
  v_i        int;
  v_share    numeric;
  rec        record;
BEGIN
  -- Manual approved concessions + payment-sourced concessions (lump-sum / Pay All).
  -- Capped so paid + concession cannot exceed the head's total.
  UPDATE fee_ledger fl
     SET concession = LEAST(
           COALESCE((
             SELECT SUM(CASE WHEN c.type = 'flat'
                             THEN c.value
                             ELSE round(fl.total_amount * c.value / 100, 2) END)
               FROM concessions c
              WHERE c.fee_ledger_id = fl.id
                AND c.status = 'approved'
           ), 0)
           + COALESCE((
             SELECT SUM(flp.concession_amount)
               FROM fee_ledger_payments flp
              WHERE flp.fee_ledger_id = fl.id
           ), 0),
           GREATEST(fl.total_amount - fl.paid_amount, 0))
   WHERE fl.student_id = p_student_id;

  SELECT lead_id INTO v_lead FROM students WHERE id = p_student_id;
  IF v_lead IS NULL THEN RETURN; END IF;

  SELECT id INTO v_offer
    FROM offer_letters
   WHERE lead_id = v_lead
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_offer IS NULL THEN RETURN; END IF;

  FOR v_term, v_category, v_wamt IN
    SELECT term, fee_category, SUM(amount)
      FROM offer_waivers
     WHERE offer_letter_id = v_offer
       AND status = 'approved'
     GROUP BY term, fee_category
     ORDER BY fee_category NULLS LAST
  LOOP
    SELECT
      COALESCE(SUM(GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0)), 0),
      COUNT(*) FILTER (WHERE GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0) > 0)
    INTO v_cap_sum, v_cnt
    FROM fee_ledger fl
    JOIN fee_codes fc ON fc.id = fl.fee_code_id
    WHERE fl.student_id = p_student_id
      AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'))
      AND (v_category IS NULL OR fc.category = v_category)
      AND NOT EXISTS (SELECT 1 FROM optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id);

    IF v_cap_sum <= 0 OR v_cnt = 0 THEN CONTINUE; END IF;

    v_capped := LEAST(v_wamt, v_cap_sum);
    v_alloc  := 0;
    v_i      := 0;

    FOR rec IN
      SELECT fl.id,
             GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0) AS cap
        FROM fee_ledger fl
        JOIN fee_codes fc ON fc.id = fl.fee_code_id
       WHERE fl.student_id = p_student_id
         AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'))
         AND (v_category IS NULL OR fc.category = v_category)
         AND GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0) > 0
         AND NOT EXISTS (SELECT 1 FROM optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id)
       ORDER BY cap DESC, fl.id
    LOOP
      v_i := v_i + 1;
      IF v_i = v_cnt THEN
        v_share := v_capped - v_alloc;
      ELSE
        v_share := round(v_capped * rec.cap / v_cap_sum, 2);
      END IF;
      UPDATE fee_ledger SET concession = concession + v_share WHERE id = rec.id;
      v_alloc := v_alloc + v_share;
    END LOOP;
  END LOOP;
END;
$function$;

-- After an offline lump-sum receipt, stamp concession_amount onto the
-- Year-1 tuition fee_ledger_payments rows (provision writes 0 today) and
-- re-sync the ledger so Concession reflects the waiver.
CREATE OR REPLACE FUNCTION public.apply_year1_lump_sum_on_payment(
  p_payment_id uuid,
  p_ledger_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay     public.lead_payments%ROWTYPE;
  v_student uuid;
  v_conc    numeric;
  v_cnt     int;
  v_i       int := 0;
  v_alloc   numeric := 0;
  v_share   numeric;
  v_cap     numeric;
  rec       record;
BEGIN
  SELECT * INTO v_pay FROM public.lead_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_conc := COALESCE(v_pay.concession_amount, 0);
  IF v_conc <= 0 OR p_ledger_ids IS NULL OR array_length(p_ledger_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_student := v_pay.student_id;
  IF v_student IS NULL AND v_pay.lead_id IS NOT NULL THEN
    SELECT id INTO v_student FROM public.students WHERE lead_id = v_pay.lead_id LIMIT 1;
  END IF;
  IF v_student IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_cnt
    FROM public.fee_ledger_payments flp
   WHERE flp.lead_payment_id = p_payment_id
     AND flp.fee_ledger_id = ANY (p_ledger_ids);

  IF v_cnt = 0 THEN
    -- Provision may not have linked yet; write the concession links directly.
    v_cnt := array_length(p_ledger_ids, 1);
    FOR rec IN
      SELECT unnest(p_ledger_ids) AS fee_ledger_id
    LOOP
      v_i := v_i + 1;
      IF v_i = v_cnt THEN
        v_share := v_conc - v_alloc;
      ELSE
        v_share := round(v_conc / v_cnt, 2);
      END IF;
      INSERT INTO public.fee_ledger_payments (fee_ledger_id, lead_payment_id, amount, concession_amount, notes)
      VALUES (rec.fee_ledger_id, p_payment_id, 0, GREATEST(v_share, 0), 'Year-1 lump-sum tuition waiver');
      v_alloc := v_alloc + GREATEST(v_share, 0);
    END LOOP;
  ELSE
    v_i := 0;
    FOR rec IN
      SELECT flp.id, flp.fee_ledger_id, flp.amount,
             GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0) AS cap
        FROM public.fee_ledger_payments flp
        JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
       WHERE flp.lead_payment_id = p_payment_id
         AND flp.fee_ledger_id = ANY (p_ledger_ids)
       ORDER BY flp.id
    LOOP
      v_i := v_i + 1;
      v_cap := rec.cap;
      IF v_i = v_cnt THEN
        v_share := LEAST(v_conc - v_alloc, v_cap);
      ELSE
        v_share := LEAST(round(v_conc * rec.amount / NULLIF((
          SELECT SUM(amount) FROM public.fee_ledger_payments
           WHERE lead_payment_id = p_payment_id AND fee_ledger_id = ANY (p_ledger_ids)
        ), 0), 2), v_cap);
      END IF;
      UPDATE public.fee_ledger_payments
         SET concession_amount = COALESCE(concession_amount, 0) + GREATEST(v_share, 0)
       WHERE id = rec.id;
      v_alloc := v_alloc + GREATEST(v_share, 0);
    END LOOP;
  END IF;

  PERFORM public.sync_fee_ledger_concessions(v_student);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_year1_lump_sum_on_payment(uuid, uuid[]) TO authenticated, service_role;

-- Canonical Year-1 tuition lump-sum quote (5% of college-collectable remaining).
-- Used by payment gateways so they never charge the ABVMU university deposit
-- or uniform as part of the one-time Year-1 waiver.
CREATE OR REPLACE FUNCTION public.year1_tuition_lump_sum_offer(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid;
  v_pct numeric := 5;
  v_remaining numeric := 0;
  v_abvmu numeric := 0;
  v_settled boolean := false;
  v_ids uuid[] := '{}';
  v_discount numeric := 0;
  v_due numeric := 0;
BEGIN
  SELECT lead_id INTO v_lead FROM public.students WHERE id = p_student_id;

  IF v_lead IS NOT NULL THEN
    v_pct := COALESCE((public.lead_fee_policy(v_lead)->>'lump_sum_first_year_waiver_pct')::numeric, 5);
    v_abvmu := COALESCE(public.lead_abvmu_deposit_amount(v_lead), 0);
    SELECT EXISTS (
      SELECT 1 FROM public.abvmu_deposit_claims
       WHERE lead_id = v_lead AND status = 'settled'
    ) INTO v_settled;
  ELSE
    SELECT COALESCE((fs.policy->>'lump_sum_first_year_waiver_pct')::numeric, 5)
      INTO v_pct
      FROM public.students s
      JOIN public.fee_structures fs
        ON fs.course_id = s.course_id AND fs.is_active = true
     WHERE s.id = p_student_id
     ORDER BY (fs.session_id = s.session_id) DESC NULLS LAST, fs.created_at DESC
     LIMIT 1;
    v_pct := COALESCE(v_pct, 5);
  END IF;

  SELECT COALESCE(SUM(fl.balance), 0),
         COALESCE(array_agg(fl.id) FILTER (WHERE fl.balance > 0), '{}')
    INTO v_remaining, v_ids
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.student_id = p_student_id
     AND lower(fl.term) = 'year_1'
     AND COALESCE(fc.category, 'tuition') = 'tuition'
     AND fc.code NOT ILIKE '%UNIFORM%'
     AND COALESCE(fc.name, '') NOT ILIKE '%UNIFORM%'
     AND fc.code IS DISTINCT FROM 'ABVMU-DEP'
     AND COALESCE(fc.name, '') NOT ILIKE '%ABVMU%DEPOSIT%';

  IF v_abvmu > 0 AND NOT v_settled THEN
    IF v_remaining + 0.01 < v_abvmu THEN
      v_remaining := 0;
    ELSE
      v_remaining := GREATEST(v_remaining - v_abvmu, 0);
    END IF;
  END IF;

  v_remaining := ROUND(v_remaining, 2);
  v_discount := CASE WHEN v_pct > 0 AND v_remaining > 0 THEN ROUND(v_remaining * v_pct / 100, 2) ELSE 0 END;
  v_due := GREATEST(v_remaining - v_discount, 0);

  RETURN jsonb_build_object(
    'eligible', (v_pct > 0 AND v_remaining > 0 AND v_discount > 0 AND v_due > 0 AND COALESCE(array_length(v_ids, 1), 0) > 0),
    'pct', v_pct,
    'remaining', v_remaining,
    'discount', v_discount,
    'amount_due', v_due,
    'fee_ids', to_jsonb(COALESCE(v_ids, '{}'))
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.year1_tuition_lump_sum_offer(uuid) TO authenticated, anon, service_role;

-- Restore wiped lump-sum concessions on anyone who already has them on the payment links.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT fl.student_id AS id
      FROM public.fee_ledger fl
      JOIN public.fee_ledger_payments flp ON flp.fee_ledger_id = fl.id
     WHERE COALESCE(flp.concession_amount, 0) > 0
  LOOP
    PERFORM public.sync_fee_ledger_concessions(r.id);
  END LOOP;
END $$;
