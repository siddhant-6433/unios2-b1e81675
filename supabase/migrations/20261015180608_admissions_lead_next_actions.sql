-- keep-migration-version: already recorded on production schema_migrations
-- admissions lead next actions

-- Batch-load the next open human follow-up for the current admissions page.
-- SECURITY INVOKER preserves the caller's lead_followups RLS scope.
CREATE OR REPLACE FUNCTION public.admissions_lead_next_actions(p_lead_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(to_jsonb(next_action) ORDER BY next_action.scheduled_at, next_action.lead_id),
    '[]'::jsonb
  )
  FROM (
    SELECT DISTINCT ON (actions.lead_id)
      actions.lead_id,
      actions.followup_id,
      actions.type,
      actions.scheduled_at,
      actions.notes
    FROM (
      SELECT
        lf.lead_id,
        lf.id AS followup_id,
        lf.type::text AS type,
        lf.scheduled_at,
        lf.notes
      FROM public.lead_followups lf
      JOIN public.leads l ON l.id = lf.lead_id
      WHERE lf.lead_id = ANY(COALESCE(p_lead_ids, ARRAY[]::uuid[]))
        AND lf.status = 'pending'
        AND lf.type IS DISTINCT FROM 'cold_followup'
        AND l.archived_at IS NULL
        AND l.stage NOT IN ('admitted', 'not_interested', 'dnc', 'rejected', 'ineligible', 'cold', 'course_not_available')

      UNION ALL

      SELECT
        cv.lead_id,
        cv.id AS followup_id,
        'visit'::text AS type,
        cv.visit_date AS scheduled_at,
        NULL::text AS notes
      FROM public.campus_visits cv
      JOIN public.leads l ON l.id = cv.lead_id
      WHERE cv.lead_id = ANY(COALESCE(p_lead_ids, ARRAY[]::uuid[]))
        AND cv.status IN ('scheduled', 'confirmed')
        AND l.archived_at IS NULL
        AND l.stage NOT IN ('admitted', 'not_interested', 'dnc', 'rejected', 'ineligible', 'cold', 'course_not_available')

      UNION ALL

      SELECT
        pv.lead_id,
        pv.visit_id AS followup_id,
        'post_visit'::text AS type,
        pv.visit_date AS scheduled_at,
        NULL::text AS notes
      FROM public.post_visit_pending_followups pv
      JOIN public.leads l ON l.id = pv.lead_id
      WHERE pv.lead_id = ANY(COALESCE(p_lead_ids, ARRAY[]::uuid[]))
        AND l.archived_at IS NULL
        AND l.stage NOT IN ('admitted', 'not_interested', 'dnc', 'rejected', 'ineligible', 'cold', 'course_not_available')
    ) AS actions
    ORDER BY actions.lead_id, actions.scheduled_at ASC, actions.followup_id ASC
  ) AS next_action;
$$;

REVOKE ALL ON FUNCTION public.admissions_lead_next_actions(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admissions_lead_next_actions(uuid[]) TO authenticated;
