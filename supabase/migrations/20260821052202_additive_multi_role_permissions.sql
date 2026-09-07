-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260821052202 name=additive_multi_role_permissions applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
