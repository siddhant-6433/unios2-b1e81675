-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260806105807 name=office_admin_inherits_accountant applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- office_admin inherits accountant (additive to school_coordinator -> office_assistant)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
    AND (
      role = _role
      OR (role = 'school_coordinator' AND _role = 'office_assistant')
      OR (role = 'office_admin'        AND _role = 'accountant')
    )
  )
$$;

-- office_admin gets every accountant permission, on top of its own.
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'office_admin'::public.app_role, rp.permission_id
FROM public.role_permissions rp
WHERE rp.role = 'accountant'::public.app_role
ON CONFLICT (role, permission_id) DO NOTHING;
