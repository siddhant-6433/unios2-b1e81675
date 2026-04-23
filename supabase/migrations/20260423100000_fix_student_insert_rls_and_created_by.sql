-- Fix 1: Add created_by column to students table for audit trail
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- Backfill existing records with NULL (no retroactive attribution possible)
-- Future inserts will track the creator

-- Fix 2: Expand the "Admins can manage students" RLS policy to include
-- principal, admission_head, data_entry, office_admin, counsellor, accountant
-- These roles need to create/update student records as part of their workflow.

DROP POLICY IF EXISTS "Admins can manage students" ON public.students;
CREATE POLICY "Staff can manage students" ON public.students
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    public.has_role(auth.uid(), 'office_assistant')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'data_entry') OR
    public.has_role(auth.uid(), 'office_admin') OR
    public.has_role(auth.uid(), 'office_assistant')
  );

-- Keep the existing SELECT policy for view-only roles (faculty, teacher, students)
-- "Staff can view students" policy already covers read access
