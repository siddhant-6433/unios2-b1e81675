-- Allow authenticated users to delete alumni verification requests (super admin enforced in app)
CREATE POLICY "Auth can delete" ON public.alumni_verification_requests
  FOR DELETE TO authenticated USING (true);

GRANT DELETE ON public.alumni_verification_requests TO authenticated;
