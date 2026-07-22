-- Deterministic ordering for admin_user_directory.
--
-- AdminPanel pages through this RPC (OFFSET/LIMIT) to load all ~1900 profiles,
-- because PostgREST caps every response at db-max-rows (1000). OFFSET pagination
-- is only correct with a fully-ordered result: the previous ORDER BY ended at
-- created_at DESC, which is non-unique (bulk-imported leads share timestamps), so
-- rows at a page boundary could be skipped or duplicated. Add profile_id as a
-- unique tiebreaker. Body is otherwise identical to
-- 20260713170000_admin_directory_phone_search_recovery.sql.

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
  deleted_at timestamptz,
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
  search_digits AS (
    SELECT regexp_replace(COALESCE(_search, ''), '\D', '', 'g') AS digits
  ),
  phone_lookup AS (
    SELECT
      length(s.digits) >= 10 AS active,
      right(s.digits, 10) AS key10
    FROM search_digits s
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
      p.deleted_at,
      p.created_at
    FROM public.profiles p
    LEFT JOIN ur ON ur.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    CROSS JOIN phone_lookup pl
    WHERE (
        public.has_role(auth.uid(), 'super_admin'::public.app_role)
        OR 'user_management:view' = ANY(public.get_user_permissions(auth.uid()))
      )
      AND (
        -- ── Normal directory listing ──────────────────────────────────────
        (
          p.deleted_at IS NULL
          AND (
            (_show_archived AND p.archived_at IS NOT NULL)
            OR (NOT _show_archived AND p.archived_at IS NULL)
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
            _status IS NULL OR _status = 'all'
            OR (_status = 'active' AND NOT COALESCE(p.login_disabled, false))
            OR (_status = 'inactive' AND COALESCE(p.login_disabled, false))
          )
          AND (
            _search IS NULL OR _search = ''
            OR p.display_name ILIKE '%' || _search || '%'
            OR p.email ILIKE '%' || _search || '%'
            OR p.phone ILIKE '%' || _search || '%'
            OR p.campus ILIKE '%' || _search || '%'
            OR ur.role::text ILIKE '%' || _search || '%'
            OR (
              pl.active
              AND right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = pl.key10
            )
          )
        )
        -- ── Phone recovery: surface holders even if soft-deleted / archived / wrong tab ──
        OR (
          pl.active
          AND right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = pl.key10
        )
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
    f.deleted_at,
    count(*) OVER() AS total_count
  FROM filtered f
  ORDER BY
    -- Prefer live profiles first when recovering a phone
    (f.deleted_at IS NOT NULL) ASC,
    (f.archived_at IS NOT NULL) ASC,
    f.created_at DESC,
    f.profile_id DESC  -- unique tiebreaker: stable OFFSET pagination
  LIMIT NULLIF(_limit, 0) OFFSET GREATEST(_offset, 0);
$$;
