-- Allow only super_admin to delete leads
CREATE POLICY "Super admin can delete leads"
  ON public.leads FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
