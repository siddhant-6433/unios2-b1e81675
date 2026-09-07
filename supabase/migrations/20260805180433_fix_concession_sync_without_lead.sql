-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260805180433 name=fix_concession_sync_without_lead applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.sync_fee_ledger_concessions(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    uuid;
  v_offer   uuid;
  v_term    text;
  v_wamt    numeric;
  v_cap_sum numeric;
  v_capped  numeric;
  v_alloc   numeric;
  v_cnt     int;
  v_i       int;
  v_share   numeric;
  rec       record;
BEGIN
  -- Per-row requested concessions. Independent of the lead/offer letter, so
  -- this runs BEFORE the lead guard: students created without a lead (direct
  -- add, bulk import) never got their approved waivers applied at all.
  -- Capped at the head's remaining so the generated balance can't go negative.
  UPDATE fee_ledger fl
     SET concession = LEAST(
           COALESCE((
             SELECT SUM(CASE WHEN c.type = 'flat'
                             THEN c.value
                             ELSE round(fl.total_amount * c.value / 100, 2) END)
               FROM concessions c
              WHERE c.fee_ledger_id = fl.id
                AND c.status = 'approved'
           ), 0),
           GREATEST(fl.total_amount - fl.paid_amount, 0))
   WHERE fl.student_id = p_student_id;

  -- Offer-letter waivers are lead-scoped; without a lead there are none.
  SELECT lead_id INTO v_lead FROM students WHERE id = p_student_id;
  IF v_lead IS NULL THEN RETURN; END IF;

  SELECT id INTO v_offer
    FROM offer_letters
   WHERE lead_id = v_lead
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_offer IS NULL THEN RETURN; END IF;

  FOR v_term, v_wamt IN
    SELECT term, SUM(amount)
      FROM offer_waivers
     WHERE offer_letter_id = v_offer
       AND status = 'approved'
     GROUP BY term
  LOOP
    SELECT
      COALESCE(SUM(GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0)), 0),
      COUNT(*) FILTER (WHERE GREATEST(fl.total_amount - fl.paid_amount - fl.concession, 0) > 0)
    INTO v_cap_sum, v_cnt
    FROM fee_ledger fl
    JOIN fee_codes fc ON fc.id = fl.fee_code_id
    WHERE fl.student_id = p_student_id
      AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'))
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

CREATE OR REPLACE FUNCTION public.request_fee_concession(_student_id uuid, _fee_ledger_id uuid, _type text, _value numeric, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile   uuid;
  v_id        uuid;
  v_total     numeric;
  v_paid      numeric;
  v_existing  numeric;
  v_new       numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF _type NOT IN ('flat', 'percentage') THEN
    RAISE EXCEPTION 'Concession type must be flat or percentage';
  END IF;
  IF _value IS NULL OR _value <= 0 THEN
    RAISE EXCEPTION 'Concession value must be greater than zero';
  END IF;
  IF _type = 'percentage' AND _value > 100 THEN
    RAISE EXCEPTION 'Percentage concession cannot exceed 100';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT total_amount, paid_amount INTO v_total, v_paid
    FROM public.fee_ledger
   WHERE id = _fee_ledger_id AND student_id = _student_id;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'Fee item does not belong to this student';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN c.type = 'flat'
                           THEN c.value
                           ELSE round(v_total * c.value / 100, 2) END), 0)
    INTO v_existing
    FROM public.concessions c
   WHERE c.fee_ledger_id = _fee_ledger_id
     AND c.status IN ('approved', 'pending_principal', 'pending_super_admin');

  v_new := CASE WHEN _type = 'flat' THEN _value ELSE round(v_total * _value / 100, 2) END;

  IF v_existing + v_new > GREATEST(v_total - v_paid, 0) THEN
    RAISE EXCEPTION 'Waivers on this head would exceed the payable amount: % already waived or pending, % remaining',
      v_existing, GREATEST(v_total - v_paid, 0);
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.concessions
    (student_id, fee_ledger_id, type, value, reason, status, requested_by)
  VALUES
    (_student_id, _fee_ledger_id, _type, _value, btrim(_reason),
     'pending_super_admin', v_profile)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT student_id FROM public.concessions WHERE status = 'approved'
  LOOP
    PERFORM public.sync_fee_ledger_concessions(r.student_id);
  END LOOP;
END $$;
