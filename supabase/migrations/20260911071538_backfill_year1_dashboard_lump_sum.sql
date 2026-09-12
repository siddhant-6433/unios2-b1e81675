-- keep-migration-version: already recorded on production schema_migrations
-- Backfill the applicant-dashboard Year-1 lump-sum waiver onto fee_ledger
-- for candidates who already paid enough to clear first-year fee after the
-- 5% shown on the offer dashboard, and keep a finance-readable register.

-- Concession-only ledger links (amount 0, concession_amount > 0) are how the
-- Year-1 waiver is stored. Production still had CHECK (amount > 0).
ALTER TABLE public.fee_ledger_payments
  DROP CONSTRAINT IF EXISTS fee_ledger_payments_amount_check;
ALTER TABLE public.fee_ledger_payments
  ADD CONSTRAINT fee_ledger_payments_amount_check CHECK (amount >= 0);

-- Let payment-sourced concessions show even when the head is already paid
-- in full (list-price collections). Otherwise Concession stays ₹0.
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
           fl.total_amount)
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

CREATE TABLE IF NOT EXISTS public.year1_lump_sum_backfill_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid UNIQUE REFERENCES public.students(id),
  lead_id uuid,
  student_name text,
  admission_no text,
  mobile text,
  course_name text,
  lump_sum_pct numeric NOT NULL,
  year1_net numeric,
  paid_toward_course numeric,
  waiver_amount numeric NOT NULL DEFAULT 0,
  applied_amount numeric NOT NULL DEFAULT 0,
  applied boolean NOT NULL DEFAULT false,
  skip_reason text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.year1_lump_sum_backfill_records IS
  'Register of Year-1 dashboard 5% waivers backfilled onto fee_ledger. Export admission_no, mobile, course_name, waiver_amount.';

CREATE OR REPLACE VIEW public.year1_lump_sum_backfill_export
WITH (security_invoker = true) AS
SELECT
  admission_no,
  mobile,
  course_name,
  student_name,
  round(waiver_amount, 2) AS waiver_amount,
  round(applied_amount, 2) AS applied_amount,
  applied,
  skip_reason,
  source,
  created_at
FROM public.year1_lump_sum_backfill_records
ORDER BY course_name, admission_no, student_name;

CREATE OR REPLACE FUNCTION public.backfill_year1_dashboard_lump_sum()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_pct numeric;
  v_post numeric;
  v_paid numeric;
  v_disc numeric;
  v_pay_conc numeric;
  v_source text;
  v_pay_id uuid;
  v_already numeric;
  v_apply numeric;
  v_share numeric;
  v_alloc numeric;
  v_cnt int;
  v_i int;
  v_room numeric;
  v_reduce numeric;
  v_left numeric;
  v_take numeric;
  rec record;
  payrec record;
  v_applied_total numeric;
  v_skip text;
  n_applied int := 0;
BEGIN
  FOR r IN
    SELECT
      s.id AS student_id,
      s.lead_id,
      s.name AS student_name,
      COALESCE(s.admission_no, s.pre_admission_no) AS admission_no,
      COALESCE(NULLIF(s.phone, ''), NULLIF(l.phone, ''), s.father_phone, s.mother_phone) AS mobile,
      c.name AS course_name
    FROM public.students s
    JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN public.courses c ON c.id = COALESCE(s.course_id, l.course_id)
    WHERE s.lead_id IS NOT NULL
      AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.year1_lump_sum_backfill_records b
         WHERE b.student_id = s.id AND b.applied
      )
  LOOP
    v_pct := COALESCE((public.lead_fee_policy(r.lead_id)->>'lump_sum_first_year_waiver_pct')::numeric, 0);
    IF v_pct <= 0 THEN CONTINUE; END IF;

    v_post := public.lead_post_scholarship_year_1(r.lead_id);
    IF COALESCE(v_post, 0) <= 0 THEN CONTINUE; END IF;

    SELECT
      COALESCE(SUM(amount) FILTER (
        WHERE type IN ('token_fee', 'pre_admission_token', 'other') AND status = 'confirmed'
      ), 0)
      + COALESCE(public.lead_abvmu_approved_credit(r.lead_id), 0)
      + LEAST(
          COALESCE(SUM(amount) FILTER (WHERE type = 'application_fee' AND status = 'confirmed'), 0),
          COALESCE((
            SELECT SUM(fsi.amount)
              FROM public.fee_structure_items fsi
              JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
             WHERE fsi.fee_structure_id = public.lead_fee_structure_id(r.lead_id)
               AND fsi.term = 'year_1'
               AND (fc.code ILIKE '%SEAT%' OR fc.name ILIKE '%SEAT%BLOCK%')
          ), 0)
        )
      INTO v_paid
    FROM public.lead_payments
    WHERE lead_id = r.lead_id;

    v_disc := ROUND(v_post * v_pct / 100, 2);

    SELECT COALESCE(SUM(COALESCE((lp.concession_breakdown->>'year_1')::numeric, 0)), 0)
      INTO v_pay_conc
      FROM public.lead_payments lp
     WHERE lp.lead_id = r.lead_id
       AND lp.status = 'confirmed'
       AND lp.concession_breakdown ? 'year_1';

    IF v_pay_conc > 0 THEN
      v_disc := v_pay_conc;
      v_source := 'payment_year1_concession';
    ELSE
      v_source := 'dashboard_formula';
    END IF;

    -- Applicant dashboard "Year 1 covered": paid enough that after the 5%
    -- nothing remains on programme Year-1 (uniform is not part of this test).
    IF COALESCE(v_paid, 0) + 0.01 < (v_post - v_disc) THEN
      CONTINUE;
    END IF;
    IF v_disc <= 0 THEN CONTINUE; END IF;

    SELECT id INTO v_pay_id
      FROM public.lead_payments
     WHERE lead_id = r.lead_id AND status = 'confirmed'
     ORDER BY (COALESCE(concession_amount, 0) > 0) DESC, created_at DESC
     LIMIT 1;

    SELECT COALESCE(SUM(flp.concession_amount), 0)
      INTO v_already
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
      JOIN public.fee_ledger_payments flp ON flp.fee_ledger_id = fl.id
     WHERE fl.student_id = r.student_id
       AND lower(fl.term) = 'year_1'
       AND COALESCE(fc.category, 'tuition') = 'tuition'
       AND fc.code NOT ILIKE '%UNIFORM%'
       AND COALESCE(fc.name, '') NOT ILIKE '%UNIFORM%'
       AND fc.code IS DISTINCT FROM 'ABVMU-DEP'
       AND COALESCE(fc.name, '') NOT ILIKE '%ABVMU%DEPOSIT%'
       AND (
         COALESCE(flp.notes, '') ILIKE '%lump-sum%'
         OR COALESCE(flp.notes, '') ILIKE '%Year-1 lump%'
       );

    v_apply := GREATEST(v_disc - COALESCE(v_already, 0), 0);
    v_applied_total := 0;
    v_skip := NULL;

    IF v_apply < 0.01 THEN
      v_skip := 'already_on_ledger';
      v_applied_total := COALESCE(v_already, 0);
    ELSIF NOT EXISTS (
      SELECT 1
        FROM public.fee_ledger fl
        JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
       WHERE fl.student_id = r.student_id
         AND lower(fl.term) = 'year_1'
         AND COALESCE(fc.category, 'tuition') = 'tuition'
         AND fc.code NOT ILIKE '%UNIFORM%'
         AND COALESCE(fc.name, '') NOT ILIKE '%UNIFORM%'
         AND fc.code IS DISTINCT FROM 'ABVMU-DEP'
         AND COALESCE(fc.name, '') NOT ILIKE '%ABVMU%DEPOSIT%'
    ) THEN
      v_skip := 'no_year1_tuition_ledger';
    ELSE
      SELECT COUNT(*) INTO v_cnt
        FROM public.fee_ledger fl
        JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
       WHERE fl.student_id = r.student_id
         AND lower(fl.term) = 'year_1'
         AND COALESCE(fc.category, 'tuition') = 'tuition'
         AND fc.code NOT ILIKE '%UNIFORM%'
         AND COALESCE(fc.name, '') NOT ILIKE '%UNIFORM%'
         AND fc.code IS DISTINCT FROM 'ABVMU-DEP'
         AND COALESCE(fc.name, '') NOT ILIKE '%ABVMU%DEPOSIT%';

      v_i := 0;
      v_alloc := 0;
      FOR rec IN
        SELECT fl.id, fl.total_amount, fl.paid_amount, fl.concession
          FROM public.fee_ledger fl
          JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
         WHERE fl.student_id = r.student_id
           AND lower(fl.term) = 'year_1'
           AND COALESCE(fc.category, 'tuition') = 'tuition'
           AND fc.code NOT ILIKE '%UNIFORM%'
           AND COALESCE(fc.name, '') NOT ILIKE '%UNIFORM%'
           AND fc.code IS DISTINCT FROM 'ABVMU-DEP'
           AND COALESCE(fc.name, '') NOT ILIKE '%ABVMU%DEPOSIT%'
         ORDER BY fl.total_amount DESC, fl.id
      LOOP
        v_i := v_i + 1;
        IF v_i = v_cnt THEN
          v_share := ROUND(v_apply - v_alloc, 2);
        ELSE
          v_share := ROUND(v_apply * rec.total_amount / NULLIF((
            SELECT SUM(fl2.total_amount)
              FROM public.fee_ledger fl2
              JOIN public.fee_codes fc2 ON fc2.id = fl2.fee_code_id
             WHERE fl2.student_id = r.student_id
               AND lower(fl2.term) = 'year_1'
               AND COALESCE(fc2.category, 'tuition') = 'tuition'
               AND fc2.code NOT ILIKE '%UNIFORM%'
               AND COALESCE(fc2.name, '') NOT ILIKE '%UNIFORM%'
               AND fc2.code IS DISTINCT FROM 'ABVMU-DEP'
          ), 0), 2);
        END IF;
        v_share := GREATEST(v_share, 0);
        IF v_share < 0.01 THEN CONTINUE; END IF;

        INSERT INTO public.fee_ledger_payments (
          fee_ledger_id, lead_payment_id, amount, concession_amount, notes
        ) VALUES (
          rec.id, NULL, 0, v_share,
          'Year-1 lump-sum tuition waiver (dashboard backfill)'
        );

        v_alloc := v_alloc + v_share;
        v_applied_total := v_applied_total + v_share;
      END LOOP;

      PERFORM public.sync_fee_ledger_concessions(r.student_id);
    END IF;

    INSERT INTO public.year1_lump_sum_backfill_records (
      student_id, lead_id, student_name, admission_no, mobile, course_name,
      lump_sum_pct, year1_net, paid_toward_course, waiver_amount, applied_amount,
      applied, skip_reason, source
    ) VALUES (
      r.student_id, r.lead_id, r.student_name, r.admission_no, r.mobile, r.course_name,
      v_pct, v_post, v_paid, v_disc, v_applied_total,
      (v_applied_total > 0.01), v_skip, v_source
    )
    ON CONFLICT (student_id) DO UPDATE
      SET waiver_amount = EXCLUDED.waiver_amount,
          applied_amount = EXCLUDED.applied_amount,
          applied = EXCLUDED.applied,
          skip_reason = EXCLUDED.skip_reason,
          source = EXCLUDED.source,
          paid_toward_course = EXCLUDED.paid_toward_course,
          year1_net = EXCLUDED.year1_net;

    IF v_applied_total > 0.01 THEN
      n_applied := n_applied + 1;
    END IF;
  END LOOP;

  RETURN n_applied;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.backfill_year1_dashboard_lump_sum() TO service_role;
GRANT SELECT ON public.year1_lump_sum_backfill_records TO authenticated, service_role;
GRANT SELECT ON public.year1_lump_sum_backfill_export TO authenticated, service_role;
GRANT ALL ON public.year1_lump_sum_backfill_records TO service_role;

ALTER TABLE public.year1_lump_sum_backfill_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS year1_lump_sum_backfill_records_finance_read
  ON public.year1_lump_sum_backfill_records;
CREATE POLICY year1_lump_sum_backfill_records_finance_read
  ON public.year1_lump_sum_backfill_records
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'office_admin')
  );

SELECT public.backfill_year1_dashboard_lump_sum();
