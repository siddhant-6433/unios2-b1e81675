-- Late Fee Engine
-- 1. Insert LATE-FEE fee code (category already exists in the CHECK constraint)
-- 2. late_fee_policies: per-fee-structure configuration for grace period and penalty
-- 3. fn_mark_overdue_fees: marks fee_ledger rows as 'overdue' respecting grace period
-- 4. fn_generate_late_fees: inserts one LATE-FEE ledger row per overdue item (idempotent)
-- 5. Daily pg_cron jobs at 6:00 AM IST (00:30 UTC) — mark first, generate 5 minutes later

-- 1. LATE-FEE fee code --------------------------------------------------
INSERT INTO public.fee_codes (code, name, category, is_recurring)
VALUES ('LATE-FEE', 'Late Fee Penalty', 'late_fee', false)
ON CONFLICT (code) DO NOTHING;

-- 2. late_fee_policies table --------------------------------------------
CREATE TABLE IF NOT EXISTS public.late_fee_policies (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_structure_id     uuid        NOT NULL REFERENCES public.fee_structures(id) ON DELETE CASCADE,
  grace_period_days    int         NOT NULL DEFAULT 7 CHECK (grace_period_days >= 0),
  penalty_type         text        NOT NULL CHECK (penalty_type IN ('flat', 'daily', 'percentage')),
  penalty_amount       numeric(12,2) NOT NULL CHECK (penalty_amount > 0),
  max_penalty_cap      numeric(12,2) CHECK (max_penalty_cap IS NULL OR max_penalty_cap > 0),
  applies_to_categories text[]     NOT NULL DEFAULT ARRAY['tuition'],
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fee_structure_id)
);

CREATE INDEX IF NOT EXISTS idx_late_fee_policies_structure
  ON public.late_fee_policies (fee_structure_id);

COMMENT ON TABLE public.late_fee_policies IS
  'Per-fee-structure late fee policy. grace_period_days after due_date, the cron marks '
  'the ledger row overdue and generates one LATE-FEE row. penalty_type flat/daily/percentage '
  'with optional cap. applies_to_categories limits which fee codes trigger a penalty.';

ALTER TABLE public.late_fee_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff can manage late fee policies"
  ON public.late_fee_policies FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'accountant')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'accountant')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.late_fee_policies TO authenticated;
GRANT ALL ON public.late_fee_policies TO service_role;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.tg_late_fee_policies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS late_fee_policies_set_updated_at ON public.late_fee_policies;
CREATE TRIGGER late_fee_policies_set_updated_at
  BEFORE UPDATE ON public.late_fee_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_late_fee_policies_updated_at();

-- 3. fn_mark_overdue_fees ------------------------------------------------
-- Marks fee_ledger rows 'overdue' when due_date + grace_period_days < today
-- and balance > 0. For rows linked to a structure with a policy, uses that
-- grace period. All others use a 7-day default.
CREATE OR REPLACE FUNCTION public.fn_mark_overdue_fees()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rows linked to a fee structure with an active policy: use configured grace period
  UPDATE fee_ledger fl
  SET    status = 'overdue'
  FROM   fee_structure_items fsi
  JOIN   late_fee_policies    lfp
      ON lfp.fee_structure_id = fsi.fee_structure_id
     AND lfp.is_active = true
  WHERE  fl.fee_structure_item_id = fsi.id
    AND  fl.status = 'due'
    AND  fl.balance > 0
    AND  fl.due_date + (lfp.grace_period_days * INTERVAL '1 day') < CURRENT_DATE;

  -- All other due rows: default 7-day grace period
  UPDATE fee_ledger fl
  SET    status = 'overdue'
  WHERE  fl.status = 'due'
    AND  fl.balance > 0
    AND  fl.due_date + INTERVAL '7 days' < CURRENT_DATE
    AND  (
           fl.fee_structure_item_id IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM   fee_structure_items fsi2
             JOIN   late_fee_policies   lfp2
                 ON lfp2.fee_structure_id = fsi2.fee_structure_id
                AND lfp2.is_active = true
             WHERE  fsi2.id = fl.fee_structure_item_id
           )
         );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mark_overdue_fees() TO service_role;

-- 4. fn_generate_late_fees -----------------------------------------------
-- For each overdue ledger row that has a matching late_fee_policy and no
-- LATE-FEE entry yet, inserts one late-fee ledger row (idempotent by term).
CREATE OR REPLACE FUNCTION public.fn_generate_late_fees()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_late_fee_code_id uuid;
  rec                record;
  v_penalty          numeric;
  v_days_overdue     int;
  v_late_term        text;
BEGIN
  SELECT id INTO v_late_fee_code_id
  FROM   fee_codes
  WHERE  code = 'LATE-FEE'
  LIMIT  1;

  IF v_late_fee_code_id IS NULL THEN RETURN; END IF;

  FOR rec IN
    SELECT
      fl.id           AS ledger_id,
      fl.student_id,
      fl.term,
      fl.balance,
      fl.due_date,
      fl.fee_structure_item_id,
      fc.category,
      lfp.penalty_type,
      lfp.penalty_amount,
      lfp.max_penalty_cap
    FROM  fee_ledger fl
    JOIN  fee_codes           fc  ON fc.id  = fl.fee_code_id
    JOIN  fee_structure_items fsi ON fsi.id = fl.fee_structure_item_id
    JOIN  late_fee_policies   lfp
        ON lfp.fee_structure_id = fsi.fee_structure_id
       AND lfp.is_active        = true
       AND fc.category          = ANY(lfp.applies_to_categories)
    WHERE fl.status      = 'overdue'
      AND fl.balance     > 0
      AND fl.fee_code_id <> v_late_fee_code_id  -- don't chain late fees
  LOOP
    v_late_term    := 'late_' || rec.term;
    v_days_overdue := CURRENT_DATE - rec.due_date;

    -- Idempotency: skip if a LATE-FEE row for this student+term already exists
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM fee_ledger fl2
      WHERE  fl2.student_id  = rec.student_id
        AND  fl2.term        = v_late_term
        AND  fl2.fee_code_id = v_late_fee_code_id
    );

    v_penalty := CASE rec.penalty_type
      WHEN 'flat'       THEN rec.penalty_amount
      WHEN 'daily'      THEN rec.penalty_amount * v_days_overdue
      WHEN 'percentage' THEN ROUND(rec.balance * rec.penalty_amount / 100.0, 2)
      ELSE rec.penalty_amount
    END;

    IF rec.max_penalty_cap IS NOT NULL THEN
      v_penalty := LEAST(v_penalty, rec.max_penalty_cap);
    END IF;

    INSERT INTO fee_ledger (
      student_id, fee_code_id, fee_structure_item_id,
      term, total_amount, due_date, status
    ) VALUES (
      rec.student_id,
      v_late_fee_code_id,
      NULL,           -- late fee rows don't trace to a template item
      v_late_term,
      v_penalty,
      CURRENT_DATE,
      'due'
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_generate_late_fees() TO service_role;

-- 5. Daily cron jobs (6:00 AM IST = 00:30 UTC) ---------------------------
SELECT cron.schedule(
  'mark-overdue-fees-daily',
  '30 0 * * *',
  $$SELECT public.fn_mark_overdue_fees()$$
);

SELECT cron.schedule(
  'generate-late-fees-daily',
  '35 0 * * *',
  $$SELECT public.fn_generate_late_fees()$$
);
