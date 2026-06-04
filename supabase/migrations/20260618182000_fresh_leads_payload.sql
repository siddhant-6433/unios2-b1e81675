-- Collapse Fresh Leads count + current page rows into one RLS-preserving call.

CREATE OR REPLACE FUNCTION public.fresh_leads_payload(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_assignment_filter text DEFAULT 'all',
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  auth_scope AS (
    SELECT
      public.get_user_role(auth.uid())::text AS role_name,
      (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1) AS own_profile_id
  ),
  scope AS (
    SELECT
      CASE WHEN role_name = 'counsellor' THEN own_profile_id ELSE p_scope_counsellor_id END AS counsellor_id,
      CASE WHEN role_name = 'counsellor' THEN 'assigned' ELSE COALESCE(p_assignment_filter, 'all') END AS assignment_filter,
      GREATEST(COALESCE(p_page, 0), 0) AS page_no,
      LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100) AS page_size
    FROM auth_scope
  ),
  filtered AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      COALESCE(l.source::text, '') AS source,
      l.created_at,
      l.counsellor_id,
      COALESCE(c.name, '—') AS course_name,
      COALESCE(cam.name, '—') AS campus_name,
      COALESCE(p.display_name, 'Unassigned') AS counsellor_name,
      floor(EXTRACT(EPOCH FROM (now() - l.created_at)) / 3600)::integer AS hours_since
    FROM public.leads l
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.campuses cam ON cam.id = l.campus_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    CROSS JOIN scope s
    WHERE l.stage = 'new_lead'
      AND l.first_contact_at IS NULL
      AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      AND (s.assignment_filter <> 'assigned' OR l.counsellor_id IS NOT NULL)
      AND (s.assignment_filter <> 'unassigned' OR l.counsellor_id IS NULL)
  ),
  total AS (
    SELECT COUNT(*)::integer AS count FROM filtered
  ),
  page_rows AS (
    SELECT f.*
    FROM filtered f, scope s
    ORDER BY created_at ASC
    LIMIT (SELECT page_size FROM scope)
    OFFSET (SELECT page_no * page_size FROM scope)
  )
SELECT jsonb_build_object(
  'totalCount', (SELECT count FROM total),
  'leads', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'name', COALESCE(name, 'Unknown'),
      'phone', COALESCE(phone, ''),
      'source', source,
      'course_name', course_name,
      'campus_name', campus_name,
      'counsellor_name', counsellor_name,
      'counsellor_id', counsellor_id,
      'created_at', created_at,
      'hours_since', hours_since
    ) ORDER BY created_at ASC)
    FROM page_rows
  ), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.fresh_leads_payload(uuid, text, integer, integer) TO authenticated;
