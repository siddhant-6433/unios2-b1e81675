-- Vice Principals start with the current Principal permission set. Grants are
-- stored against their own role so the dashboard can edit them independently.
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'vice_principal'::public.app_role, permission_id
FROM public.role_permissions
WHERE role = 'principal'::public.app_role
ON CONFLICT (role, permission_id) DO NOTHING;

-- Existing policies and security-definer RPCs that check the Principal role
-- also recognize Vice Principals. Role identity and grants remain distinct.
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
      OR (role = 'office_admin' AND _role = 'accountant')
      OR (role = 'vice_principal' AND _role = 'principal')
    )
  )
$$;
