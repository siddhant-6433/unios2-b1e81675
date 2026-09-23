-- concession select for waiver management
-- Give fee-ledger waiver managers enough read access to see existing
-- concession rows before editing or removing them. The campus predicate keeps
-- scoped principals/office staff limited to assigned campuses.

DROP POLICY IF EXISTS "concessions_select" ON public.concessions;
CREATE POLICY "concessions_select" ON public.concessions
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'principal'::public.app_role) OR
        public.has_role(auth.uid(), 'accountant'::public.app_role) OR
        public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
        public.has_role(auth.uid(), 'office_assistant'::public.app_role) OR
        public.has_role(auth.uid(), 'school_coordinator'::public.app_role) OR
        public.has_role(auth.uid(), 'counsellor'::public.app_role)
      )
      AND EXISTS (
        SELECT 1
        FROM public.students s
        WHERE s.id = concessions.student_id
          AND public.user_can_access_record_campus(auth.uid(), s.campus_id)
      )
    )
  );

NOTIFY pgrst, 'reload schema';
