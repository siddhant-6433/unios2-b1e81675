-- Granular (per-component) offer-letter waivers.
--
-- A waiver could only target a period (term). But each quarter is the sum of
-- separate fee heads sharing that term — tuition + hostel (boarding) + transport
-- — so a "waive tuition only" intent was inexpressible, and the ledger sync split
-- every term waiver pro-rata across ALL heads of the term, bleeding a tuition
-- waiver onto boarding/transport.
--
-- Add an optional target category to the waiver (NULL = whole period = the exact
-- prior behavior) and make the ledger sync route the concession only to heads of
-- that fee_codes.category.

ALTER TABLE public.offer_waivers
  ADD COLUMN IF NOT EXISTS fee_category text;  -- NULL = applies across all heads in the term

COMMENT ON COLUMN public.offer_waivers.fee_category IS
  'Target fee_codes.category (tuition/hostel/transport/…). NULL = applies across all heads in the term (legacy behavior).';

-- Component-aware ledger sync. Only the offer-waiver grouping and head-matching
-- change vs 20260805180648: group waivers by (term, fee_category) and, when a
-- category is set, restrict candidate heads to that fee_codes.category. The
-- per-row manual-concession reset (which zeroes structural concessions before
-- waivers are re-applied) and the pro-rata split are unchanged. Targeted groups
-- (fee_category NOT NULL) are processed before whole-period groups so a
-- tuition-only waiver consumes its head first; capacity is read live per group.
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
  -- Per-row requested concessions. Applies to ad-hoc heads too: if someone
  -- asked for a waiver on the meal charge, they meant the meal charge.
  -- Independent of the lead/offer letter, so this runs before the lead guard.
  -- Capped at the head's remaining so the generated balance can't go negative.
  -- This also resets structural (waiver-driven) concessions to 0 before the
  -- offer-waiver loop re-applies them from source.
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

  FOR v_term, v_category, v_wamt IN
    SELECT term, fee_category, SUM(amount)
      FROM offer_waivers
     WHERE offer_letter_id = v_offer
       AND status = 'approved'
     GROUP BY term, fee_category
     ORDER BY fee_category NULLS LAST   -- targeted heads before whole-period spread
  LOOP
    -- Candidate heads: same term (+ NB-SEC alias for the security deposit),
    -- excluding cashier ad-hoc heads, restricted to the target category when set.
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

-- Re-sync every student on an approved offer so the ledger reflects the new
-- component-aware routing (a no-op for existing NULL-category waivers).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.id
      FROM public.students s
      JOIN public.offer_letters o ON o.lead_id = s.lead_id AND o.approval_status = 'approved'
     WHERE s.lead_id IS NOT NULL
  LOOP
    PERFORM public.sync_fee_ledger_concessions(r.id);
  END LOOP;
END $$;
