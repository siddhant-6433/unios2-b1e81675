-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260813044328 name=permissions_manage_policy applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP POLICY IF EXISTS "Super admins can manage permissions" ON public.permissions;
CREATE POLICY "Super admins can manage permissions" ON public.permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT INSERT, UPDATE, DELETE ON public.permissions TO authenticated;
