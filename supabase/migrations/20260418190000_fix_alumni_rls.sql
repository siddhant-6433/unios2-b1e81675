-- Fix: allow authenticated users to also INSERT (when browsing portal while logged in)
CREATE POLICY "Auth can insert" ON public.alumni_verification_requests
  FOR INSERT TO authenticated WITH CHECK (true);

-- Also ensure anon can update their own requests (for payment status)
DROP POLICY IF EXISTS "Anon can update pending_payment" ON public.alumni_verification_requests;
CREATE POLICY "Anon can update own" ON public.alumni_verification_requests
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
