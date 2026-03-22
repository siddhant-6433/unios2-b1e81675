-- Fix 1: Ensure authenticated role has explicit grants on profiles
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Fix 2: Add staff-level SELECT policy so counsellors/admins can see all profiles
-- (needed for TeamManagement user dropdowns, etc.)
-- Drop the existing admin-only policy and replace with a broader one
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Staff can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'faculty') OR
    public.has_role(auth.uid(), 'teacher') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_assistant') OR
    public.has_role(auth.uid(), 'hostel_warden')
  );

-- Fix 3: Ensure user_roles grants are also in place
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
