-- Restrict DELETE on offer_letters to super_admin only.
-- The current FOR ALL policy allows any admissions staff to delete rows.
-- Split it into per-operation policies so DELETE is gated to super_admin.

DROP POLICY IF EXISTS "Staff can manage offers" ON public.offer_letters;

CREATE POLICY "Staff can select offers"
  ON public.offer_letters FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')    OR
    public.has_role(auth.uid(), 'campus_admin')   OR
    public.has_role(auth.uid(), 'principal')      OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')     OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Staff can insert offers"
  ON public.offer_letters FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')    OR
    public.has_role(auth.uid(), 'campus_admin')   OR
    public.has_role(auth.uid(), 'principal')      OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')     OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Staff can update offers"
  ON public.offer_letters FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')    OR
    public.has_role(auth.uid(), 'campus_admin')   OR
    public.has_role(auth.uid(), 'principal')      OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')     OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "Super admin can delete offers"
  ON public.offer_letters FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
