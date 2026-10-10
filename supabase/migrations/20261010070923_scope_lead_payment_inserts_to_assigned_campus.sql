-- keep-migration-version: restored from production schema_migrations.
-- Keep offline receipt creation limited to staff roles and records in their
-- assigned campus. Student receipts may be lead-less; scope those through the
-- student's campus just as the receipt read policy does.

DROP POLICY IF EXISTS "Staff can insert lead_payments" ON public.lead_payments;

CREATE POLICY "Staff can insert lead_payments" ON public.lead_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
        public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'data_entry'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role)
      )
      AND (lead_payments.lead_id IS NOT NULL OR lead_payments.student_id IS NOT NULL)
      AND (
        lead_payments.lead_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.id = lead_payments.lead_id
            AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
        )
      )
      AND (
        lead_payments.student_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = lead_payments.student_id
            AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
