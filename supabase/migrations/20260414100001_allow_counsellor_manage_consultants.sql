-- Fix: counsellors cannot add/edit consultants (RLS blocks INSERT/UPDATE)
-- The "Staff can manage consultants" policy only included super_admin,
-- campus_admin, and admission_head. Add counsellor and principal.

DROP POLICY IF EXISTS "Staff can manage consultants" ON public.consultants;

CREATE POLICY "Staff can manage consultants" ON public.consultants
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );
