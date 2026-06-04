-- Collapse Cloud Dialer mount-time reads that were still hitting:
--   - profiles (identity)
--   - lead_activities (template-frequency scan)
--   - source_sla_config
--   - courses/departments/institutions/campuses
-- and replace the non-smart fresh/all queue scans with a single RLS-safe RPC.

CREATE OR REPLACE FUNCTION public.cloud_dialer_bootstrap()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  me AS (
    SELECT
      p.id AS profile_id,
      COALESCE(p.display_name, 'the admissions team') AS display_name,
      p.phone
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
    LIMIT 1
  ),
  template_counts AS (
    SELECT
      replace(lower((regexp_match(la.description, 'Template:\s*([a-z0-9_ ]+)', 'i'))[1]), ' ', '_') AS template_key,
      count(*)::int AS uses
    FROM public.lead_activities la
    JOIN me ON me.profile_id = la.user_id
    WHERE la.type = 'whatsapp'
      AND la.created_at >= now() - interval '30 days'
      AND regexp_match(la.description, 'Template:\s*([a-z0-9_ ]+)', 'i') IS NOT NULL
    GROUP BY 1
  ),
  top_templates AS (
    SELECT template_key, uses
    FROM template_counts
    WHERE template_key IS NOT NULL
      AND template_key <> ''
      AND template_key NOT IN ('course_info_v4', 'course_info_generic', 'auto_reply', 'ai_auto_reply')
    ORDER BY uses DESC, template_key ASC
    LIMIT 2
  ),
  template_rows AS (
    SELECT jsonb_build_object(
      'key', template_key,
      'label', CASE template_key
        WHEN 'apply_portal_login' THEN 'Send apply portal link'
        WHEN 'callback_scheduled' THEN 'Send callback ack'
        WHEN 'missed_call' THEN 'Send missed-call note'
        WHEN 'course_info_video' THEN 'Send course video'
        WHEN 'course_info_video_v2' THEN 'Send course video'
        WHEN 'visit_confirmation' THEN 'Send visit confirmation'
        WHEN 'ai_call_post_summary' THEN 'Send call summary'
        WHEN 'ai_call_course_info' THEN 'Send course details'
        ELSE replace(template_key, '_', ' ')
      END
    ) AS row
    FROM top_templates
  ),
  sla_rows AS (
    SELECT source, first_contact_hours
    FROM public.source_sla_config
  ),
  course_rows AS (
    SELECT
      c.id,
      c.name,
      COALESCE(cmp.name, '') AS campus
    FROM public.courses c
    LEFT JOIN public.departments d ON d.id = c.department_id
    LEFT JOIN public.institutions i ON i.id = d.institution_id
    LEFT JOIN public.campuses cmp ON cmp.id = i.campus_id
    WHERE c.is_active = true
    ORDER BY c.name ASC
  )
SELECT jsonb_build_object(
  'counsellor_identity', COALESCE(
    (SELECT jsonb_build_object(
      'display_name', display_name,
      'phone', phone
    ) FROM me),
    jsonb_build_object('display_name', 'the admissions team', 'phone', NULL)
  ),
  'most_used_templates', COALESCE(
    (SELECT jsonb_agg(row) FROM template_rows),
    '[]'::jsonb
  ),
  'source_sla_hours', COALESCE(
    (SELECT jsonb_object_agg(source, first_contact_hours) FROM sla_rows),
    '{}'::jsonb
  ),
  'course_options', COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'campus', campus
    ) ORDER BY name ASC) FROM course_rows),
    '[]'::jsonb
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.cloud_dialer_bootstrap() TO authenticated;

CREATE OR REPLACE FUNCTION public.cloud_dialer_list_queue(
  p_counsellor_id uuid DEFAULT NULL,
  p_mode text DEFAULT 'fresh',
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  selected AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.stage,
      l.source,
      l.course_id,
      l.created_at
    FROM public.leads l
    WHERE l.phone IS NOT NULL
      AND (
        (p_mode = 'fresh' AND l.stage = 'new_lead')
        OR
        (p_mode = 'all' AND l.stage IN ('priority_interested', 'new_lead', 'counsellor_call', 'application_in_progress'))
      )
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    ORDER BY l.created_at ASC
    LIMIT p_limit
  ),
  enriched AS (
    SELECT
      s.id,
      s.name,
      s.phone,
      s.stage,
      COALESCE(s.source::text, '') AS source,
      s.course_id,
      COALESCE(c.name, '—') AS course_name,
      c.fee_per_year AS course_fee_per_year,
      COALESCE(cmp.name, '—') AS campus_name,
      CASE
        WHEN p_mode = 'fresh' THEN 'New Lead'
        ELSE CASE s.stage
          WHEN 'priority_interested' THEN 'Priority Interested'
          WHEN 'new_lead' THEN 'New Lead'
          WHEN 'counsellor_call' THEN 'Follow Up'
          WHEN 'application_in_progress' THEN 'App In Progress'
          WHEN 'visit_scheduled' THEN 'Visit Scheduled'
          WHEN 'application_fee_paid' THEN 'Fee Paid'
          ELSE s.stage::text
        END
      END AS bucket,
      CASE
        WHEN p_mode = 'fresh' THEN 7
        ELSE CASE s.stage
          WHEN 'priority_interested' THEN 1
          WHEN 'new_lead' THEN 2
          WHEN 'counsellor_call' THEN 3
          WHEN 'application_in_progress' THEN 4
          ELSE 99
        END
      END AS bucket_priority,
      0::int AS attempt_count,
      s.created_at
    FROM selected s
    LEFT JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN public.campuses cmp ON cmp.id = (
      SELECT i.campus_id
      FROM public.departments d
      JOIN public.institutions i ON i.id = d.institution_id
      WHERE d.id = c.department_id
      LIMIT 1
    )
  ),
  queue_count AS (
    SELECT count(*)::int AS total
    FROM enriched
  )
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) - 'created_at' ORDER BY e.created_at ASC, e.id ASC) FROM enriched e),
    '[]'::jsonb
  ),
  'buckets', COALESCE(
    (
      SELECT CASE
        WHEN qc.total > 0 THEN jsonb_build_array(jsonb_build_object(
          'bucket_priority', CASE WHEN p_mode = 'fresh' THEN 7 ELSE 99 END,
          'label', CASE WHEN p_mode = 'fresh' THEN 'New Leads' ELSE 'All Pipeline' END,
          'count', qc.total
        ))
        ELSE '[]'::jsonb
      END
      FROM queue_count qc
    ),
    '[]'::jsonb
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.cloud_dialer_list_queue(uuid, text, integer) TO authenticated;
