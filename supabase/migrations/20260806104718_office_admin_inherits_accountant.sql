-- ====================================================================
-- Give the Office Administrator (office_admin) role full Accountant-level
-- access, IN ADDITION to everything office_admin already has, for all
-- branches. Fee-receipt creation, cashier desk, concessions, day-close,
-- offer-letter/late-fee management, etc. are all gated on the accountant
-- role — either by has_role(uid,'accountant') in RLS/RPCs, or by the
-- permission system (finance:*).
--
-- Two seams cover the whole surface:
--   1. has_role() — extend it so an office_admin user also satisfies
--      has_role(uid,'accountant'). This is the same inheritance pattern
--      already used for school_coordinator -> office_assistant, so every
--      existing RLS policy + SECURITY DEFINER RPC that checks accountant
--      automatically covers office_admin too (present and future).
--   2. role_permissions — copy every permission granted to accountant
--      onto office_admin, so permission-gated routes (/finance,
--      /collections) and permission-gated UI open up as well. ON CONFLICT
--      DO NOTHING preserves office_admin's own existing permissions.
-- ====================================================================

-- 1. office_admin inherits accountant (additive to the school_coordinator
--    inheritance already in place).
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

-- 2. office_admin gets every accountant permission, on top of its own.
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'office_admin'::public.app_role, rp.permission_id
FROM public.role_permissions rp
WHERE rp.role = 'accountant'::public.app_role
ON CONFLICT (role, permission_id) DO NOTHING;
