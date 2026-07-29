-- Fix the admissions_overview "overdueFollowups" card so it agrees with the
-- drill-down list. Two problems, both here:
--
-- 1. NOT deduped: the card summed two row-counts
--      (SELECT c FROM overdue_followups) + (SELECT c FROM ai_needs_followup)
--    so a lead with 3 pending followups counted 3, and a lead in both sources
--    counted twice. Switch to COUNT(DISTINCT lead_id) over the UNION.
--
-- 2. Ignored the overdue-followup enforcement flag. The overdue_followups VIEW
--    (and every other followup surface — Pending Follow-ups, TAT defaults) gates
--    on get_overdue_followup_enforcement_enabled(); the card did NOT. With
--    enforcement OFF (its current state) the view is empty and the drill-down
--    shows only AI followups (~9 for a counsellor), while the card counted all
--    358 lead_followups rows — the "358 → 9" contradiction. Add the same gate so
--    the card tracks the drill-down: enforcement OFF → AI-only; ON → both.
--
-- NOTE: prod runs the self-contained LANGUAGE sql version from 20260620114000
-- (the later 20260620121000 "wrapper" migration referencing admissions_overview_base
-- was never applied — DB-push drift). This restores that self-contained body,
-- changing ONLY the overdueFollowups tally.

CREATE OR REPLACE FUNCTION public.admissions_overview(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  scoped_leads AS (
    SELECT l.id, l.stage, l.counsellor_id, l.campus_id, l.ai_called
    FROM public.leads l
    WHERE l.is_mirror = false
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
      AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
  ),
  stage_counts AS (
    SELECT l.stage::text AS stage, count(*)::int AS count
    FROM scoped_leads l
    GROUP BY l.stage
  ),
  new_lead_assignment_counts AS (
    SELECT
      count(*) FILTER (WHERE l.stage = 'new_lead' AND l.counsellor_id IS NOT NULL)::int AS assigned,
      count(*) FILTER (WHERE l.stage = 'new_lead' AND l.counsellor_id IS NULL)::int AS unassigned,
      count(*) FILTER (
        WHERE l.stage = 'new_lead'
          AND l.counsellor_id IS NULL
          AND COALESCE(l.ai_called, false) = true
      )::int AS unassigned_ai_called,
      count(*) FILTER (
        WHERE l.stage = 'new_lead'
          AND l.counsellor_id IS NULL
          AND COALESCE(l.ai_called, false) = false
      )::int AS unassigned_not_ai_called
    FROM scoped_leads l
  ),
  interested_leads AS (
    SELECT DISTINCT cl.lead_id
    FROM public.call_logs cl
    JOIN scoped_leads l ON l.id = cl.lead_id
    WHERE cl.disposition = 'interested'
  ),
  missed_callbacks AS (
    SELECT count(*)::int AS c
    FROM public.call_logs cl
    JOIN scoped_leads l ON l.id = cl.lead_id
    WHERE cl.direction = 'inbound'
      AND cl.disposition = 'missed'
  ),
  -- Distinct leads needing follow-up: overdue human followups UNION AI-flagged
  -- followups. UNION (not ALL) dedupes within each source and across both.
  overdue_followup_leads AS (
    SELECT lf.lead_id
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    WHERE public.get_overdue_followup_enforcement_enabled()
      AND lf.status = 'pending'
      AND lf.scheduled_at < now()
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
    UNION
    SELECT acr.lead_id
    FROM public.ai_call_records acr
    JOIN scoped_leads l ON l.id = acr.lead_id
    WHERE acr.needs_followup = true
      AND acr.followup_done_at IS NULL
  ),
  visit_stats AS (
    SELECT
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= now()
      )::int AS scheduled,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= date_trunc('day', now())
          AND cv.visit_date < date_trunc('day', now()) + interval '1 day'
      )::int AS scheduled_today,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date >= now()
          AND cv.visit_date < now() + interval '7 days'
      )::int AS scheduled_this_week,
      count(*) FILTER (
        WHERE cv.status IN ('scheduled', 'confirmed')
          AND cv.visit_date < now()
      )::int AS checkin_pending,
      count(*) FILTER (
        WHERE cv.status = 'completed'
          AND cv.visit_date >= now() - interval '14 days'
      )::int AS visits_completed
    FROM public.campus_visits cv
    JOIN scoped_leads l ON l.id = cv.lead_id
  ),
  post_visit_pending AS (
    SELECT count(*)::int AS c
    FROM public.post_visit_pending_followups pv
    JOIN scoped_leads l ON l.id = pv.lead_id
  ),
  visit_funnel_raw AS (
    SELECT vf.lead_id, vf.funnel_box
    FROM public.visit_funnel_leads vf
    JOIN scoped_leads l ON l.id = vf.lead_id
    WHERE p_counsellor_id IS NULL OR vf.counsellor_id = p_counsellor_id
  ),
  visit_funnel_counts AS (
    SELECT funnel_box, count(*)::int AS count
    FROM visit_funnel_raw
    GROUP BY funnel_box
  ),
  visit_funnel_box_ids AS (
    SELECT jsonb_object_agg(funnel_box, lead_ids) AS boxes
    FROM (
      SELECT funnel_box, jsonb_agg(lead_id ORDER BY lead_id) AS lead_ids
      FROM visit_funnel_raw
      GROUP BY funnel_box
    ) grouped
  )
SELECT jsonb_build_object(
  'stage_counts',
  COALESCE(
    (SELECT jsonb_object_agg(stage, count) FROM stage_counts),
    '{}'::jsonb
  ),
  'new_lead_assignment_counts',
  jsonb_build_object(
    'assigned', (SELECT assigned FROM new_lead_assignment_counts),
    'unassigned', (SELECT unassigned FROM new_lead_assignment_counts),
    'unassigned_ai_called', (SELECT unassigned_ai_called FROM new_lead_assignment_counts),
    'unassigned_not_ai_called', (SELECT unassigned_not_ai_called FROM new_lead_assignment_counts)
  ),
  'interested_lead_ids',
  COALESCE(
    (SELECT jsonb_agg(lead_id ORDER BY lead_id) FROM interested_leads),
    '[]'::jsonb
  ),
  'visit_action_counts',
  jsonb_build_object(
    'missedCallbacks', (SELECT c FROM missed_callbacks),
    'overdueFollowups', (SELECT count(*)::int FROM overdue_followup_leads),
    'scheduled', (SELECT scheduled FROM visit_stats),
    'scheduledToday', (SELECT scheduled_today FROM visit_stats),
    'scheduledThisWeek', (SELECT scheduled_this_week FROM visit_stats),
    'checkinPending', (SELECT checkin_pending FROM visit_stats),
    'visitsCompleted', (SELECT visits_completed FROM visit_stats),
    'visitsCompletedPendingFollowup', (SELECT c FROM post_visit_pending)
  ),
  'visit_funnel_counts',
  jsonb_build_object(
    'scheduled', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'scheduled'), 0),
    'confirmed', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'confirmed'), 0),
    'completed', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'completed'), 0),
    'visit_followup', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'visit_followup'), 0),
    'applied', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'applied'), 0),
    'admitted', COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'admitted'), 0)
  ),
  'visit_funnel_leakage',
  COALESCE((SELECT count FROM visit_funnel_counts WHERE funnel_box = 'leakage'), 0),
  'visit_funnel_box_ids',
  COALESCE((SELECT boxes FROM visit_funnel_box_ids), '{}'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.admissions_overview(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
