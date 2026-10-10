-- Keep application-fee repair snapshots campus-scoped and audit the removal of
-- duplicate allocations created when links were consolidated onto one head.

DROP POLICY IF EXISTS "Finance can view application fee duplicate repairs"
  ON public.fee_ledger_duplicate_repairs;
CREATE POLICY "Finance can view application fee duplicate repairs"
  ON public.fee_ledger_duplicate_repairs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'vice_principal'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = fee_ledger_duplicate_repairs.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );

CREATE TABLE public.application_fee_duplicate_link_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  fee_ledger_id uuid NOT NULL REFERENCES public.fee_ledger(id),
  lead_payment_id uuid NOT NULL REFERENCES public.lead_payments(id),
  fee_ledger_payment_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('deleted', 'reduced')),
  amount_before numeric(12,2) NOT NULL,
  amount_after numeric(12,2),
  payment_amount numeric(12,2) NOT NULL,
  before_row jsonb NOT NULL,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_fee_duplicate_link_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance can view application fee duplicate link repairs"
  ON public.application_fee_duplicate_link_repairs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'vice_principal'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = application_fee_duplicate_link_repairs.student_id
          AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
      )
    )
  );
GRANT SELECT ON public.application_fee_duplicate_link_repairs TO authenticated;
GRANT ALL ON public.application_fee_duplicate_link_repairs TO service_role;

DO $repair$
DECLARE
  v_payment RECORD;
  v_link RECORD;
  v_excess numeric;
  v_target_total numeric;
  v_trim numeric;
  v_student_id uuid;
BEGIN
  -- The excess must be wholly attributable to links on heads consolidated by
  -- the earlier repair. Otherwise fail closed and leave finance links intact.
  FOR v_payment IN
    SELECT lp.id, lp.amount, SUM(flp.amount) AS linked_total
      FROM public.lead_payments lp
      JOIN public.fee_ledger_payments flp ON flp.lead_payment_id = lp.id
     GROUP BY lp.id, lp.amount
    HAVING SUM(flp.amount) > lp.amount + 0.009
       AND EXISTS (
         SELECT 1
           FROM public.fee_ledger_payments target_link
          WHERE target_link.lead_payment_id = lp.id
            AND EXISTS (
              SELECT 1 FROM public.fee_ledger_duplicate_repairs repair
               WHERE target_link.fee_ledger_id = repair.canonical_fee_ledger_id
                  OR target_link.fee_ledger_id = ANY(repair.removed_fee_ledger_ids)
            )
       )
  LOOP
    v_excess := v_payment.linked_total - v_payment.amount;

    SELECT COALESCE(SUM(flp.amount), 0)
      INTO v_target_total
      FROM public.fee_ledger_payments flp
     WHERE flp.lead_payment_id = v_payment.id
       AND EXISTS (
         SELECT 1 FROM public.fee_ledger_duplicate_repairs repair
          WHERE flp.fee_ledger_id = repair.canonical_fee_ledger_id
             OR flp.fee_ledger_id = ANY(repair.removed_fee_ledger_ids)
       );

    IF v_target_total + 0.009 < v_excess THEN
      RAISE EXCEPTION
        'Cannot safely reconcile application-fee payment %: excess % exceeds links on repaired heads %',
        v_payment.id, v_excess, v_target_total;
    END IF;

    FOR v_link IN
      SELECT flp.*, fl.student_id
        FROM public.fee_ledger_payments flp
        JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
       WHERE flp.lead_payment_id = v_payment.id
         AND EXISTS (
           SELECT 1 FROM public.fee_ledger_duplicate_repairs repair
            WHERE flp.fee_ledger_id = repair.canonical_fee_ledger_id
               OR flp.fee_ledger_id = ANY(repair.removed_fee_ledger_ids)
         )
       ORDER BY flp.applied_at DESC, flp.id DESC
    LOOP
      EXIT WHEN v_excess <= 0.009;

      IF EXISTS (
        SELECT 1 FROM public.fee_refund_items fri
         WHERE fri.fee_ledger_payment_id = v_link.id
      ) THEN
        RAISE EXCEPTION
          'Cannot safely reconcile application-fee allocation %: refund history exists',
          v_link.id;
      END IF;

      v_trim := LEAST(v_link.amount, v_excess);
      IF v_trim >= v_link.amount - 0.009 THEN
        INSERT INTO public.application_fee_duplicate_link_repairs (
          student_id, fee_ledger_id, lead_payment_id, fee_ledger_payment_id,
          action, amount_before, amount_after, payment_amount, before_row
        ) VALUES (
          v_link.student_id, v_link.fee_ledger_id, v_link.lead_payment_id, v_link.id,
          'deleted', v_link.amount, NULL, v_payment.amount, to_jsonb(v_link)
        );
        DELETE FROM public.fee_ledger_payments WHERE id = v_link.id;
      ELSE
        INSERT INTO public.application_fee_duplicate_link_repairs (
          student_id, fee_ledger_id, lead_payment_id, fee_ledger_payment_id,
          action, amount_before, amount_after, payment_amount, before_row
        ) VALUES (
          v_link.student_id, v_link.fee_ledger_id, v_link.lead_payment_id, v_link.id,
          'reduced', v_link.amount, v_link.amount - v_trim,
          v_payment.amount, to_jsonb(v_link)
        );
        UPDATE public.fee_ledger_payments
           SET amount = amount - v_trim
         WHERE id = v_link.id;
      END IF;

      v_excess := v_excess - v_trim;
    END LOOP;

    IF v_excess > 0.009 THEN
      RAISE EXCEPTION
        'Could not fully reconcile application-fee payment %; untrimmed excess % remains',
        v_payment.id, v_excess;
    END IF;
  END LOOP;
END;
$repair$;

NOTIFY pgrst, 'reload schema';
