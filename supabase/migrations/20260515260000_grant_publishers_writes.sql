-- Allow authenticated users to write to public.publishers at the table-grant level.
-- The "Admins manage publishers" RLS policy still restricts actual writes to super_admin
-- and campus_admin; without the GRANT, even admins hit a "permission denied for table"
-- error before RLS is evaluated.
GRANT INSERT, UPDATE, DELETE ON public.publishers TO authenticated;
