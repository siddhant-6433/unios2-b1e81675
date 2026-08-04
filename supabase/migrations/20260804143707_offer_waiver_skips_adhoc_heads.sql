-- An offer waiver must not leak onto an ad-hoc fee head.
--
-- offer_waivers are term-level ("₹50,740 off Q4"), and
-- sync_fee_ledger_concessions spread each one pro-rata across EVERY fee_ledger
-- row in that term. It had no notion of structural versus ad-hoc, so the moment
-- a cashier levied a custom head into a waived term, the scholarship silently
-- re-spread to include it.
--
-- Observed: a Q4 waiver of ₹50,740 landed as
--   NB-CBA  ₹36,001.47   (56,184 / 79,185 of it)
--   NB-CPY   ₹8,971.53   (14,001 / 79,185)
--   IB-MEAL  ₹5,767.00   ( 9,000 / 79,185)   <-- a meal add-on, discounted by a
--                                                 tuition scholarship nobody
--                                                 granted against it
--
-- Two things were wrong. The add-on became part-free, and the tuition heads the
-- waiver WAS granted against quietly lost cover as their share was diluted —
-- charging a candidate more for tuition simply because they opted into meals.
--
-- Ad-hoc heads are the ones a super_admin enabled in optional_fee_heads and a
-- cashier levied via levy_fee_charge. They are extras billed on top, never part
-- of the structure an offer was written against, so they are excluded from the
-- distribution entirely.
--
-- NOT touched: the per-row `concessions` block at the top of the function. A
-- waiver deliberately requested ON an ad-hoc row (Finance → the row's Waiver
-- control) is still honoured in full — that one was actually granted against it.

CREATE OR REPLACE FUNCTION public.sync_fee_ledger_concessions(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  SELECT lead_id INTO v_lead FROM students WHERE id = p_student_id;
  IF v_lead IS NULL THEN RETURN; END IF;

  -- Per-row requested concessions. Applies to ad-hoc heads too: if someone
  -- asked for a waiver on the meal charge, they meant the meal charge.
  UPDATE fee_ledger fl
     SET concession = COALESCE((
           SELECT SUM(CASE WHEN c.type = 'flat'
                           THEN c.value
                           ELSE round(fl.total_amount * c.value / 100, 2) END)
             FROM concessions c
            WHERE c.fee_ledger_id = fl.id
              AND c.status = 'approved'
         ), 0)
   WHERE fl.student_id = p_student_id;

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
$$;

-- Recompute every student who currently has an offer-waiver share sitting on an
-- ad-hoc head. sync_fee_ledger_concessions rebuilds concession from source, so
-- re-running it both strips the leak and restores the tuition heads' full share.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT fl.student_id
      FROM public.fee_ledger fl
     WHERE fl.concession > 0
       AND EXISTS (SELECT 1 FROM public.optional_fee_heads o WHERE o.fee_code_id = fl.fee_code_id)
  LOOP
    PERFORM public.sync_fee_ledger_concessions(r.student_id);
  END LOOP;
END $$;
