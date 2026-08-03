-- The per-user permission dialog could not read the rows it exists to manage.
--
-- user_permission_overrides had exactly one SELECT policy, auth.uid() = user_id,
-- so an admin opening someone ELSE's permissions always got zero rows back. Every
-- permission rendered as "from role" / "none", never "granted" / "revoked" — so a
-- revoke that HAD saved still looked un-saved on reopen, and the dialog reported
-- the wrong current state.
--
-- Writes stay super_admin-only; this is read-only and additive.

DROP POLICY IF EXISTS "Super admin reads all overrides" ON public.user_permission_overrides;
CREATE POLICY "Super admin reads all overrides"
  ON public.user_permission_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));
