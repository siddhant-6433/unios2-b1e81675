-- Principals already see students through campus OR institution/course grants.
-- Finance reads must use the same scope, including lead-less school receipts.
-- Additive SELECT policies only: existing role and write policies remain intact.

DROP POLICY IF EXISTS "Principal can view scoped student ledger" ON public.fee_ledger;
CREATE POLICY "Principal can view scoped student ledger" ON public.fee_ledger
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fee_ledger.student_id
        AND (
          public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
          OR public.user_can_access_course_scope(auth.uid(), s.course_id)
        )
    )
  );

DROP POLICY IF EXISTS "Principal can view scoped student ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Principal can view scoped student ledger payments" ON public.fee_ledger_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      JOIN public.students s ON s.id = fl.student_id
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND (
          public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
          OR public.user_can_access_course_scope(auth.uid(), s.course_id)
        )
    )
  );

DROP POLICY IF EXISTS "Principal can read scoped student receipts" ON public.lead_payments;
CREATE POLICY "Principal can read scoped student receipts" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND lead_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = lead_payments.student_id
        AND (
          public.user_can_access_assigned_campus(auth.uid(), s.campus_id)
          OR public.user_can_access_course_scope(auth.uid(), s.course_id)
        )
    )
  );

-- User-confirmed repair: Jai Gopal Jindal is principal of Avantika II only.
-- His legacy profiles.campus='NIMT School' resolves to no actual campus.
-- An institution grant fixes the assignment without broadening campus access
-- or granting Arthala. Skip environments without this production principal.
DO $$
BEGIN
  IF public.has_role('e73c3a3d-a1f0-4617-847f-26e608cdd190'::uuid, 'principal'::public.app_role) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.institutions
      WHERE id = '0ddbdc8b-778d-45ef-8718-93202f231170'::uuid
        AND campus_id = '9bb6b4cc-c992-4af1-b9d3-384537a510c8'::uuid
        AND type = 'school'
    ) THEN
      RAISE EXCEPTION 'Avantika II school identity mismatch; principal assignment was not changed';
    END IF;

    INSERT INTO public.user_institution_access (user_id, institution_id, role)
    VALUES (
      'e73c3a3d-a1f0-4617-847f-26e608cdd190'::uuid,
      '0ddbdc8b-778d-45ef-8718-93202f231170'::uuid,
      'principal'::public.app_role
    )
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
