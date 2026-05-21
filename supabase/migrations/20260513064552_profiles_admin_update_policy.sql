-- Allow super_admin to update any user's profile (name, email, phone, etc.)
-- Previously only "Users can update own profile" existed, so admin edits
-- in EmployeeProfileDialog were silently dropped by RLS.

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.has_role(auth.uid(), 'super_admin'));
