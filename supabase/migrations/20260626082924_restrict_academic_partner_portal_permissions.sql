-- Restrict academic partners to the dedicated portal.
--
-- Academic partners still read rows through table grants, but the RLS policies
-- below scope those rows to:
--   - students in assigned course/batch scope
--   - financial rows only for students whose lead is mapped to that partner
-- Removing broad UI permissions prevents access to Marketing, CRM lists,
-- full Students, and full Finance surfaces.

DELETE FROM public.role_permissions rp
USING public.permissions p
WHERE rp.role = 'academic_partner'::public.app_role
  AND rp.permission_id = p.id
  AND (p.module, p.action) IN (
    ('dashboard', 'view'),
    ('students', 'view'),
    ('attendance', 'view'),
    ('finance', 'view'),
    ('leads', 'view'),
    ('leads', 'create'),
    ('courses_fees', 'view')
  );

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'academic_partner'::public.app_role, id
FROM public.permissions
WHERE (module, action) = ('academic_partner_portal', 'view')
ON CONFLICT (role, permission_id) DO NOTHING;

DROP POLICY IF EXISTS "Academic partners view assigned students" ON public.students;
CREATE POLICY "Academic partners view assigned students"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::public.app_role)
    AND course_id IS NOT NULL
    AND public.is_academic_partner_scope(auth.uid(), course_id, batch_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned fee ledger" ON public.fee_ledger;
DROP POLICY IF EXISTS "Academic partners view mapped fee ledger" ON public.fee_ledger;
CREATE POLICY "Academic partners view mapped fee ledger"
  ON public.fee_ledger FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::public.app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned payments" ON public.payments;
DROP POLICY IF EXISTS "Academic partners view mapped payments" ON public.payments;
CREATE POLICY "Academic partners view mapped payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::public.app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned ledger payments" ON public.fee_ledger_payments;
DROP POLICY IF EXISTS "Academic partners view mapped ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Academic partners view mapped ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND public.can_academic_partner_view_fee_student(auth.uid(), fl.student_id)
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned applications" ON public.applications;
DROP POLICY IF EXISTS "Academic partners view mapped applications" ON public.applications;
CREATE POLICY "Academic partners view mapped applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::public.app_role)
    AND lead_id IS NOT NULL
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );
