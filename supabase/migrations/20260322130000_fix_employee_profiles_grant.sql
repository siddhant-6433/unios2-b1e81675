-- Grant table-level permissions on employee_profiles so RLS policies can fire
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_profiles TO authenticated;
