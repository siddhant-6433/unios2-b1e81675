-- One payload for global/sidebar admission badges.
-- SECURITY INVOKER: all table reads still run under caller RLS.

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
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
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_include_unassigned, true) END AS include_unassigned,
      role_name
    FROM auth_scope
  ),
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      date_trunc('day', now()) + interval '1 day' AS tomorrow_start
  ),
  counts AS (
    SELECT jsonb_build_object(
      'overdue', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.lead_followups lf
        JOIN public.leads l ON l.id = lf.lead_id
        CROSS JOIN scope s
        WHERE lf.status = 'pending'
          AND lf.scheduled_at < now()
          AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'today', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.lead_followups lf
        JOIN public.leads l ON l.id = lf.lead_id
        CROSS JOIN bounds b
        CROSS JOIN scope s
        WHERE lf.status = 'pending'
          AND lf.scheduled_at >= b.today_start
          AND lf.scheduled_at < b.tomorrow_start
          AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'fresh', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.leads l
        CROSS JOIN scope s
        WHERE l.stage = 'new_lead'
          AND l.first_contact_at IS NULL
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'new_leads_total', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.leads l
        CROSS JOIN scope s
        WHERE l.stage = 'new_lead'
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'unassigned', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.leads l
        CROSS JOIN scope s
        WHERE s.include_unassigned = true
          AND s.counsellor_id IS NULL
          AND l.stage = 'new_lead'
          AND l.counsellor_id IS NULL
      ), 0),
      'unclosed', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.campus_visits cv
        JOIN public.leads l ON l.id = cv.lead_id
        CROSS JOIN scope s
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date::date <= CURRENT_DATE
          AND cv.visit_date::date >= CURRENT_DATE - 7
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'confirm', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.campus_visits cv
        JOIN public.leads l ON l.id = cv.lead_id
        CROSS JOIN scope s
        WHERE cv.status = 'scheduled'
          AND cv.visit_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'post_visit', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.campus_visits cv
        JOIN public.leads l ON l.id = cv.lead_id
        CROSS JOIN scope s
        WHERE cv.status = 'completed'
          AND cv.visit_date >= now() - interval '14 days'
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.call_logs cl
            WHERE cl.lead_id = cv.lead_id
              AND cl.called_at > cv.visit_date
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.lead_followups lf
            WHERE lf.lead_id = cv.lead_id
              AND lf.status = 'completed'
              AND lf.completed_at > cv.visit_date
          )
      ), 0),
      'ai_needs_followup', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.ai_call_records acr
        JOIN public.leads l ON l.id = acr.lead_id
        CROSS JOIN scope s
        WHERE acr.needs_followup = true
          AND acr.followup_done_at IS NULL
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'missed_callbacks', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.call_logs cl
        JOIN public.leads l ON l.id = cl.lead_id
        CROSS JOIN scope s
        WHERE cl.direction = 'inbound'
          AND cl.disposition = 'missed'
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'hot', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.leads l
        CROSS JOIN scope s
        WHERE s.counsellor_id IS NOT NULL
          AND l.stage = 'priority_interested'
          AND l.counsellor_id = s.counsellor_id
      ), 0),
      'priority_interested_total', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.leads l
        CROSS JOIN scope s
        WHERE l.stage = 'priority_interested'
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'wa_unread', COALESCE((
        SELECT COUNT(*)::integer
        FROM public.whatsapp_messages wm
        LEFT JOIN public.leads l ON l.id = wm.lead_id
        CROSS JOIN scope s
        WHERE wm.direction = 'inbound'
          AND wm.is_read = false
          AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      ), 0),
      'reclaim_soon', COALESCE((
        SELECT CASE
          WHEN s.counsellor_id IS NULL THEN 0
          ELSE public.fn_count_leads_reclaim_soon(s.counsellor_id, 30)
        END
        FROM scope s
      ), 0),
      'tat_defaults', COALESCE((
        SELECT CASE
          WHEN s.role_name = 'counsellor' THEN COALESCE((
            SELECT ctd.total_defaults::integer
            FROM public.counsellor_tat_defaults ctd
            WHERE ctd.user_id = auth.uid()
            LIMIT 1
          ), 0)
          ELSE COALESCE((SELECT SUM(ctd.total_defaults)::integer FROM public.counsellor_tat_defaults ctd), 0)
        END
        FROM scope s
      ), 0)
    ) AS payload
  )
SELECT payload FROM counts;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;
