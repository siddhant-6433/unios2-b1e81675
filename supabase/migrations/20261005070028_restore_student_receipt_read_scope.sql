-- keep-migration-version: already applied to production as 20261005070028.
-- Restore direct student receipt reads lost in campus_data_isolation.
-- Keep the existing staff roles and strict campus checks. Receipts with a
-- lead continue to use that lead's campus; only lead-less receipts use the
-- student's campus. Principal institution/course SELECT policies stay intact.
-- No INSERT, UPDATE or DELETE policy changes.

DROP POLICY IF EXISTS "Staff can read lead_payments" ON public.lead_payments;
CREATE POLICY "Staff can read lead_payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin') OR
        public.has_role(auth.uid(), 'principal') OR
        public.has_role(auth.uid(), 'admission_head') OR
        public.has_role(auth.uid(), 'counsellor') OR
        public.has_role(auth.uid(), 'accountant') OR
        public.has_role(auth.uid(), 'data_entry') OR
        public.has_role(auth.uid(), 'office_admin') OR
        public.has_role(auth.uid(), 'office_assistant')
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.id = lead_payments.lead_id
            AND public.user_can_access_assigned_campus(auth.uid(), l.campus_id)
        )
        OR (
          lead_payments.lead_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.id = lead_payments.student_id
              AND public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
          )
        )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
