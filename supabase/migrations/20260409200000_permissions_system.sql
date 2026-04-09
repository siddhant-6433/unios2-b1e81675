-- =====================================================
-- Granular Access Control System
-- =====================================================

-- 1. Registry of all possible permissions
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(module, action)
);

-- 2. Default permissions per role
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, permission_id)
);

-- 3. Per-user overrides (grant or revoke)
CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  granted boolean NOT NULL,  -- true=grant, false=revoke
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, permission_id)
);

-- 4. RPC to get effective permissions for a user (called once on login)
-- RPC (idempotent via CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_role AS (
    SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
  ),
  role_perms AS (
    SELECT p.module || ':' || p.action AS pkey
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role = (SELECT role FROM user_role)
  ),
  overrides AS (
    SELECT p.module || ':' || p.action AS pkey, upo.granted
    FROM user_permission_overrides upo
    JOIN permissions p ON p.id = upo.permission_id
    WHERE upo.user_id = _user_id
  )
  SELECT COALESCE(array_agg(DISTINCT final.pkey), ARRAY[]::text[])
  FROM (
    SELECT rp.pkey FROM role_perms rp
    WHERE NOT EXISTS (SELECT 1 FROM overrides o WHERE o.pkey = rp.pkey AND o.granted = false)
    UNION
    SELECT o.pkey FROM overrides o WHERE o.granted = true
  ) final;
$$;

-- 5. RLS (idempotent)
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read permissions" ON public.permissions;
CREATE POLICY "Anyone can read permissions" ON public.permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admin manages role_permissions" ON public.role_permissions;
CREATE POLICY "Super admin manages role_permissions" ON public.role_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Authenticated can read role_permissions" ON public.role_permissions;
CREATE POLICY "Authenticated can read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Super admin manages overrides" ON public.user_permission_overrides;
CREATE POLICY "Super admin manages overrides" ON public.user_permission_overrides FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Users can read own overrides" ON public.user_permission_overrides;
CREATE POLICY "Users can read own overrides" ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 6. Grants
GRANT SELECT ON public.permissions TO authenticated, service_role;
GRANT ALL ON public.role_permissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.user_permission_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permission_overrides TO authenticated;
