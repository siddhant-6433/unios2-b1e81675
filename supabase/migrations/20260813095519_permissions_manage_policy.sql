-- The `permissions` registry had a read policy and nothing else, so the
-- Permission Matrix could grant/revoke existing permissions but could never add
-- a new module:action without a migration. Give super_admin write access so
-- wiring up a new gate is a config change.
--
-- role_permissions and user_permission_overrides already cascade on
-- permission_id, so deleting a permission revokes it everywhere.

DROP POLICY IF EXISTS "Super admins can manage permissions" ON public.permissions;
CREATE POLICY "Super admins can manage permissions" ON public.permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT INSERT, UPDATE, DELETE ON public.permissions TO authenticated;
