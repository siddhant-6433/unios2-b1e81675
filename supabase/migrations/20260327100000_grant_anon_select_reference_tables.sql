-- Allow anonymous (unauthenticated portal) users to read public reference tables.
-- Portal applicants authenticate via WhatsApp OTP which does not create a Supabase
-- auth session, so the existing TO authenticated policies block them.

CREATE POLICY "Anon users can view campuses"
  ON public.campuses FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can view institutions"
  ON public.institutions FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can view departments"
  ON public.departments FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can view courses"
  ON public.courses FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can view admission sessions"
  ON public.admission_sessions FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can view batches"
  ON public.batches FOR SELECT TO anon USING (true);
