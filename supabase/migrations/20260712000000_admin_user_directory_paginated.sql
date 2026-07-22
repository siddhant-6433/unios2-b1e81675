-- Scalable Admin Panel user directory.
--
-- Before: admin_user_directory returned every matching profile row and the
-- browser filtered/counted client-side. Supabase caps API responses at 1000
-- rows, so on a >1000-row profiles table only the newest 1000 profiles reached
-- the client. Because recent signups are overwhelmingly roleless leads, every
-- staff/consultant/admin fell outside that window and their tabs showed 0.
--
-- After: the server filters + paginates (one page of rows) and a sibling RPC
-- returns every badge/stat count from a single indexed aggregate pass. Data
-- transfer stays constant regardless of table size.
--
-- Also fixes a latent duplicate-row bug: user_roles allows many roles per user
-- (123 users have >1), so the old LEFT JOIN emitted duplicate directory rows.
-- Both RPCs now pick one deterministic PRIMARY role per user via priority.

-- Priority: staff/employee roles rank above consultant/partner/publisher, which
-- rank above student/parent. A multi-role user shows under their highest role.
-- Keep this list in sync with public.app_role.
--   ARRAY[...]  (used identically in both functions below)

DROP FUNCTION IF EXISTS public.admin_user_directory(boolean);

CREATE OR REPLACE FUNCTION public.admin_user_directory(
  _show_archived boolean DEFAULT false,
  _category text DEFAULT NULL,
  _role text DEFAULT NULL,
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  profile_id uuid,
  display_name text,
  email text,
  phone text,
  campus text,
  role public.app_role,
  role_id uuid,
  last_sign_in_at timestamptz,
  profile_updated_at timestamptz,
  login_disabled boolean,
  last_seen_at timestamptz,
  archived_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ur AS (
    SELECT DISTINCT ON (u.user_id) u.user_id, u.id AS role_id, u.role
    FROM public.user_roles u
    ORDER BY u.user_id, array_position(
      ARRAY['super_admin','campus_admin','principal','admission_head','office_admin',
            'accountant','counsellor','faculty','teacher','data_entry','office_assistant',
            'hostel_warden','librarian','ib_coordinator','video_editor','consultant',
            'academic_partner_offer_letter','academic_partner','publisher','student','parent']::text[],
      u.role::text)
  ),
  filtered AS (
    SELECT
      p.user_id,
      p.id AS profile_id,
      p.display_name,
      p.email,
      p.phone,
      p.campus,
      ur.role,
      ur.role_id,
      au.last_sign_in_at,
      p.updated_at AS profile_updated_at,
      COALESCE(p.login_disabled, false) AS login_disabled,
      p.last_seen_at,
      p.archived_at,
      p.created_at
    FROM public.profiles p
    LEFT JOIN ur ON ur.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    WHERE p.deleted_at IS NULL
      AND (
        (_show_archived AND p.archived_at IS NOT NULL)
        OR (NOT _show_archived AND p.archived_at IS NULL)
      )
      AND (
        public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR 'user_management:view' = ANY(public.get_user_permissions(auth.uid()))
      )
      AND (
        _category IS NULL
        OR (_category = 'employees' AND ur.role IS NOT NULL AND ur.role::text NOT IN ('student','parent','consultant','academic_partner','academic_partner_offer_letter','publisher'))
        OR (_category = 'consultants' AND ur.role::text = 'consultant')
        OR (_category = 'academic_partners' AND ur.role::text IN ('academic_partner','academic_partner_offer_letter'))
        OR (_category = 'publishers' AND ur.role::text = 'publisher')
        OR (_category = 'families' AND ur.role::text IN ('student','parent'))
        OR (_category = 'leads' AND ur.role IS NULL)
      )
      AND (_role IS NULL OR ur.role::text = _role)
      AND (
        _search IS NULL OR _search = ''
        OR p.display_name ILIKE '%' || _search || '%'
        OR p.email ILIKE '%' || _search || '%'
        OR p.phone ILIKE '%' || _search || '%'
        OR p.campus ILIKE '%' || _search || '%'
        OR ur.role::text ILIKE '%' || _search || '%'
      )
      AND (
        _status IS NULL OR _status = 'all'
        OR (_status = 'active' AND NOT COALESCE(p.login_disabled, false))
        OR (_status = 'inactive' AND COALESCE(p.login_disabled, false))
      )
  )
  SELECT
    f.user_id,
    f.profile_id,
    f.display_name,
    f.email,
    f.phone,
    f.campus,
    f.role,
    f.role_id,
    f.last_sign_in_at,
    f.profile_updated_at,
    f.login_disabled,
    f.last_seen_at,
    f.archived_at,
    count(*) OVER() AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT NULLIF(_limit, 0) OFFSET GREATEST(_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_directory(boolean, text, text, text, text, int, int) TO authenticated;

-- Sibling aggregate: every badge/stat count in one indexed pass, no rows shipped.
CREATE OR REPLACE FUNCTION public.admin_user_directory_counts(_show_archived boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ur AS (
    SELECT DISTINCT ON (u.user_id) u.user_id, u.role
    FROM public.user_roles u
    ORDER BY u.user_id, array_position(
      ARRAY['super_admin','campus_admin','principal','admission_head','office_admin',
            'accountant','counsellor','faculty','teacher','data_entry','office_assistant',
            'hostel_warden','librarian','ib_coordinator','video_editor','consultant',
            'academic_partner_offer_letter','academic_partner','publisher','student','parent']::text[],
      u.role::text)
  ),
  base AS (
    SELECT
      ur.role,
      p.last_seen_at,
      COALESCE(p.login_disabled, false) AS login_disabled,
      p.phone,
      p.email
    FROM public.profiles p
    LEFT JOIN ur ON ur.user_id = p.user_id
    WHERE p.deleted_at IS NULL
      AND (
        (_show_archived AND p.archived_at IS NOT NULL)
        OR (NOT _show_archived AND p.archived_at IS NULL)
      )
      AND (
        public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR 'user_management:view' = ANY(public.get_user_permissions(auth.uid()))
      )
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'active', count(*) FILTER (WHERE NOT login_disabled),
    'inactive', count(*) FILTER (WHERE login_disabled),
    'online_now', count(*) FILTER (WHERE last_seen_at > now() - interval '2 minutes'),
    'employees', count(*) FILTER (WHERE role IS NOT NULL AND role::text NOT IN ('student','parent','consultant','academic_partner','academic_partner_offer_letter','publisher')),
    'consultants', count(*) FILTER (WHERE role::text = 'consultant'),
    'academic_partners', count(*) FILTER (WHERE role::text IN ('academic_partner','academic_partner_offer_letter')),
    'families', count(*) FILTER (WHERE role::text IN ('student','parent')),
    'leads', count(*) FILTER (WHERE role IS NULL),
    'admins', count(*) FILTER (WHERE role::text IN ('super_admin','campus_admin')),
    'counsellors', count(*) FILTER (WHERE role::text = 'counsellor'),
    'consultants_with_phone', count(*) FILTER (WHERE role::text = 'consultant' AND phone IS NOT NULL AND phone <> ''),
    'consultants_with_email', count(*) FILTER (WHERE role::text = 'consultant' AND email IS NOT NULL AND email <> ''),
    'partners_with_phone', count(*) FILTER (WHERE role::text IN ('academic_partner','academic_partner_offer_letter') AND phone IS NOT NULL AND phone <> ''),
    'partners_with_email', count(*) FILTER (WHERE role::text IN ('academic_partner','academic_partner_offer_letter') AND email IS NOT NULL AND email <> ''),
    'families_students', count(*) FILTER (WHERE role::text = 'student'),
    'families_parents', count(*) FILTER (WHERE role::text = 'parent'),
    'leads_with_phone', count(*) FILTER (WHERE role IS NULL AND phone IS NOT NULL AND phone <> ''),
    'leads_with_email', count(*) FILTER (WHERE role IS NULL AND email IS NOT NULL AND email <> ''),
    'by_role', COALESCE(
      (SELECT jsonb_object_agg(r.role, r.c)
       FROM (SELECT role::text AS role, count(*) AS c FROM base WHERE role IS NOT NULL GROUP BY role) r),
      '{}'::jsonb)
  )
  FROM base;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_directory_counts(boolean) TO authenticated;
