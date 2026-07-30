-- ====================================================================
-- Canonical concession sync — the fee_ledger.concession for a student is
-- ALWAYS the exact sum of:
--   (a) approved manual concessions (concessions table), and
--   (b) approved offer waivers (offer_waivers), distributed across the
--       matching-term ledger rows.
--
-- Recompute-from-source: the function resets concession to the manual
-- base then re-applies waivers, so it is fully idempotent — running it
-- once or ten times yields the same result. This is what lets an offer
-- waiver "map exactly as approved" with no need to re-provision: whenever
-- a waiver is approved/edited/deleted, a trigger re-runs the sync and the
-- ledger matches the approved waivers again.
--
-- Distribution rules (mirror provision-student-fees):
--   * waiver term matches ledger term exactly (q1..q4, year_1..N, admission…)
--   * 'security_deposit' waivers map to the NB-SEC ledger row
--   * a term's waiver is split across its rows proportional to each row's
--     REMAINING CAPACITY (total - paid - concession_so_far), capped so a
--     row's balance can never go negative. Rounding remainder lands on the
--     last row so the per-term concession sums to the approved amount.
--   * ponytail: if a waiver exceeds the remaining due (rare, mostly-paid
--     rows), the excess is dropped rather than creating a credit here —
--     overpayment/credit is a separate flow.
-- ====================================================================

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

  -- (a) Reset every row to its approved MANUAL concession base (0 if none).
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

  -- Latest approved offer letter for this lead.
  SELECT id INTO v_offer
    FROM offer_letters
   WHERE lead_id = v_lead
     AND approval_status = 'approved'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_offer IS NULL THEN RETURN; END IF;

  -- (b) Add each approved waiver term's share on top of the manual base.
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
      AND (fl.term = v_term OR (v_term = 'security_deposit' AND fc.code = 'NB-SEC'));

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
       ORDER BY cap DESC, fl.id
    LOOP
      v_i := v_i + 1;
      IF v_i = v_cnt THEN
        v_share := v_capped - v_alloc;                       -- remainder on last row
      ELSE
        v_share := round(v_capped * rec.cap / v_cap_sum, 2); -- proportional
      END IF;
      UPDATE fee_ledger SET concession = concession + v_share WHERE id = rec.id;
      v_alloc := v_alloc + v_share;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_fee_ledger_concessions(uuid) TO authenticated, service_role;

-- Trigger: any change to a waiver's approval/amount re-syncs the ledger for
-- that offer's student(s). Fires no matter how the waiver was decided
-- (edge function or direct RLS update), so approvals always reach the ledger.
CREATE OR REPLACE FUNCTION public.tg_sync_concessions_on_waiver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead    uuid;
  v_student uuid;
BEGIN
  SELECT ol.lead_id INTO v_lead
    FROM offer_letters ol
   WHERE ol.id = COALESCE(NEW.offer_letter_id, OLD.offer_letter_id);
  IF v_lead IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  FOR v_student IN SELECT id FROM students WHERE lead_id = v_lead LOOP
    PERFORM public.sync_fee_ledger_concessions(v_student);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_sync_ledger ON public.offer_waivers;
CREATE TRIGGER offer_waivers_sync_ledger
AFTER INSERT OR DELETE OR UPDATE OF status, amount ON public.offer_waivers
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_concessions_on_waiver();
