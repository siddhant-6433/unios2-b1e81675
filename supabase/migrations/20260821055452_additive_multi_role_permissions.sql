-- Additive multi-role support.
--
-- user_roles already allows multiple rows per user (UNIQUE(user_id, role)); the
-- only thing assuming one role is the read path. Make effective permissions the
-- UNION across every role a user holds, and make the single "primary" role that
-- the UI/impersonation still needs deterministic (highest-privilege first)
-- instead of an arbitrary LIMIT 1.

-- 1. Effective permissions = union of every held role's grants, minus per-user
--    revokes, plus per-user grants. (Was: a single arbitrary role.)
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_perms AS (
    SELECT p.module || ':' || p.action AS pkey
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role IN (SELECT role FROM public.user_roles WHERE user_id = _user_id)
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

-- 2. Deterministic primary role: highest-privilege wins, so a user who is (say)
--    super_admin + counsellor still resolves to super_admin. Same priority order
--    the admin directory uses. Unknown roles sort last.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY COALESCE(
    array_position(
      ARRAY['super_admin','campus_admin','principal','admission_head','office_admin',
            'accountant','counsellor','faculty','teacher','data_entry','office_assistant',
            'hostel_warden','librarian','ib_coordinator','video_editor','consultant',
            'academic_partner_offer_letter','academic_partner','publisher',
            'school_coordinator','non_teaching','student','parent']::text[],
      role::text),
    999)
  LIMIT 1
$$;
