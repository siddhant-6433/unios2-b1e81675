-- keep-migration-version: already recorded on production schema_migrations
-- crm shadow intent fit scoring

-- Explainable intent/fit scoring in shadow mode. It does not update lead_score,
-- lead_temperature, queue order, or incentive calculations.
CREATE OR REPLACE FUNCTION public.crm_lead_score_shadow(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH lead_row AS MATERIALIZED (
    SELECT l.id, l.stage::text AS stage, l.course_id, l.campus_id,
      l.qualifying_percent, l.interview_score, l.first_contact_at, l.last_engaged_at,
      l.lead_score AS legacy_score, l.lead_temperature AS legacy_temperature
    FROM public.leads l WHERE l.id = p_lead_id AND l.archived_at IS NULL
  ),
  signals AS (
    SELECT l.*,
      (SELECT count(*)::integer FROM public.lead_activities a
       WHERE a.lead_id = l.id AND lower(a.type) IN ('whatsapp_reply', 'whatsapp_inbound', 'inbound_message', 'student_reply')
         AND a.created_at >= now() - interval '60 days') AS recent_replies,
      (SELECT count(*)::integer FROM public.call_logs cl
       WHERE cl.lead_id = l.id AND cl.called_at >= now() - interval '60 days'
         AND cl.disposition IN ('interested', 'call_back', 'callback', 'connected')) AS recent_connected_calls,
      (SELECT count(*)::integer FROM public.call_logs cl
       WHERE cl.lead_id = l.id AND cl.called_at >= now() - interval '90 days'
         AND cl.disposition IN ('not_answered', 'no_answer', 'busy', 'voicemail')) AS unanswered_attempts,
      (SELECT count(*)::integer FROM public.campus_visits cv
       WHERE cv.lead_id = l.id AND cv.status = 'completed'
         AND cv.visit_date >= now() - interval '60 days') AS recent_completed_visits,
      (SELECT max(a.created_at) FROM public.lead_activities a
       WHERE a.lead_id = l.id AND lower(a.type) IN ('whatsapp_reply', 'whatsapp_inbound', 'inbound_message', 'student_reply')) AS last_reply_at,
      (SELECT max(cl.called_at) FROM public.call_logs cl
       WHERE cl.lead_id = l.id AND cl.disposition IN ('interested', 'call_back', 'callback', 'connected')) AS last_connected_call_at
    FROM lead_row l
  ),
  components AS (
    SELECT s.*,
      CASE s.stage
        WHEN 'application_in_progress' THEN 25 WHEN 'application_fee_paid' THEN 35
        WHEN 'application_submitted' THEN 45 WHEN 'visit_scheduled' THEN 20
        WHEN 'interview' THEN 25 WHEN 'offer_sent' THEN 35 WHEN 'token_paid' THEN 45
        WHEN 'pre_admitted' THEN 50 ELSE 0 END AS milestone_points,
      least(20, s.recent_replies * 10) AS reply_points,
      least(15, s.recent_connected_calls * 5) AS connected_call_points,
      least(20, s.recent_completed_visits * 20) AS visit_points,
      CASE
        WHEN greatest(s.last_engaged_at, s.last_reply_at, s.last_connected_call_at) >= now() - interval '7 days' THEN 20
        WHEN greatest(s.last_engaged_at, s.last_reply_at, s.last_connected_call_at) >= now() - interval '30 days' THEN 10
        WHEN greatest(s.last_engaged_at, s.last_reply_at, s.last_connected_call_at) < now() - interval '60 days' THEN -20
        ELSE 0
      END AS recency_points,
      CASE WHEN s.course_id IS NOT NULL THEN 15 ELSE 0 END AS course_fit_points,
      CASE WHEN s.campus_id IS NOT NULL THEN 5 ELSE 0 END AS campus_fit_points,
      least(50, greatest(0, coalesce(s.qualifying_percent, 0) * 0.5))::integer AS qualification_fit_points,
      least(30, greatest(0, coalesce(s.interview_score, 0) * 0.3))::integer AS interview_fit_points
    FROM signals s
  ),
  scores AS (
    SELECT c.*,
      greatest(0, least(100, c.milestone_points + c.reply_points + c.connected_call_points + c.visit_points + c.recency_points)) AS intent_score,
      greatest(0, least(100, c.course_fit_points + c.campus_fit_points + c.qualification_fit_points + c.interview_fit_points)) AS fit_score
    FROM components c
  )
  SELECT jsonb_build_object(
    'version', 'shadow-v2-2026-10', 'mode', 'shadow', 'evaluated_at', now(),
    'intent_score', s.intent_score, 'fit_score', s.fit_score,
    'temperature', CASE
      WHEN s.stage IN ('application_fee_paid', 'application_submitted', 'visit_scheduled', 'interview', 'offer_sent', 'token_paid', 'pre_admitted')
        OR (s.intent_score >= 70 AND s.fit_score >= 35) THEN 'hot'
      WHEN s.intent_score <= 25 AND s.unanswered_attempts >= 3
        AND greatest(s.last_engaged_at, s.last_reply_at, s.last_connected_call_at) < now() - interval '30 days' THEN 'cold'
      ELSE 'warm' END,
    'unworked', s.first_contact_at IS NULL,
    'unanswered_attempts_90d', s.unanswered_attempts,
    'legacy_score', s.legacy_score, 'legacy_temperature', s.legacy_temperature,
    'intent_reasons', jsonb_build_array(
      jsonb_build_object('key','stage_milestone','label','Admission intent milestone','points',s.milestone_points),
      jsonb_build_object('key','student_replies','label','Recent student replies','points',s.reply_points,'events',s.recent_replies),
      jsonb_build_object('key','connected_calls','label','Recent connected calls','points',s.connected_call_points,'events',s.recent_connected_calls),
      jsonb_build_object('key','completed_visits','label','Recent completed visits','points',s.visit_points,'events',s.recent_completed_visits),
      jsonb_build_object('key','recency','label','Engagement recency','points',s.recency_points)
    ),
    'fit_reasons', jsonb_build_array(
      jsonb_build_object('key','course','label','Course selected','points',s.course_fit_points),
      jsonb_build_object('key','campus','label','Campus selected','points',s.campus_fit_points),
      jsonb_build_object('key','qualification','label','Qualification match','points',s.qualification_fit_points,'source_percent',s.qualifying_percent),
      jsonb_build_object('key','interview','label','Interview evaluation','points',s.interview_fit_points,'source_score',s.interview_score)
    ),
    'policy', jsonb_build_object(
      'temperature_rules','Hot: strong intent plus fit or major milestone; Cold: at least three recent unanswered attempts plus 30 days without meaningful engagement; Warm: all other cases.',
      'untouched_leads_are_not_cold', true,
      'payout_effect', false,
      'queue_order_effect', false
    )
  )
  FROM scores s;
$$;

REVOKE ALL ON FUNCTION public.crm_lead_score_shadow(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_lead_score_shadow(uuid) TO authenticated;

-- Attribute delay signals to the owner in place at the task's breach deadline.
CREATE OR REPLACE FUNCTION public.counsellor_crm_reliability_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS MATERIALIZED (
    SELECT p.id AS profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1
  ),
  day_bounds AS (
    SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS day_start,
      ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day') AT TIME ZONE 'Asia/Kolkata') AS next_day
  ),
  task_owner AS MATERIALIZED (
    SELECT lf.id, lf.lead_id, lf.type, lf.status, lf.scheduled_at, lf.completed_at,
      COALESCE(
        (SELECT h.previous_owner_user_id FROM public.lead_followup_owner_history h
         WHERE h.followup_id = lf.id AND h.changed_at > lf.scheduled_at + interval '24 hours'
         ORDER BY h.changed_at LIMIT 1),
        lf.user_id, current_owner.user_id
      ) AS owner_at_deadline
    FROM public.lead_followups lf
    JOIN public.leads l ON l.id = lf.lead_id
    LEFT JOIN public.profiles current_owner ON current_owner.id = l.counsellor_id
    WHERE l.archived_at IS NULL AND lf.type IS DISTINCT FROM 'cold_followup'
  ),
  fresh_breaches AS (
    SELECT count(*)::integer AS n
    FROM public.leads l
    LEFT JOIN public.source_sla_config sla ON sla.source = l.source::text
    CROSS JOIN me
    WHERE l.archived_at IS NULL AND l.stage::text = 'new_lead'
      AND l.first_contact_at IS NULL AND l.assigned_at IS NOT NULL
      AND now() > l.assigned_at + make_interval(hours => COALESCE(sla.first_contact_hours, 4))
      AND COALESCE(
        (SELECT p.user_id FROM public.lead_assignment_history h JOIN public.profiles p ON p.id = h.assigned_to
         WHERE h.lead_id = l.id
           AND h.created_at <= l.assigned_at + make_interval(hours => COALESCE(sla.first_contact_hours, 4))
         ORDER BY h.created_at DESC LIMIT 1),
        (SELECT p.user_id FROM public.lead_assignment_history h JOIN public.profiles p ON p.id = h.previous_counsellor_id
         WHERE h.lead_id = l.id
           AND h.created_at > l.assigned_at + make_interval(hours => COALESCE(sla.first_contact_hours, 4))
         ORDER BY h.created_at LIMIT 1),
        (SELECT p.user_id FROM public.profiles p WHERE p.id = l.counsellor_id)
      ) = auth.uid()
  ),
  counts AS (
    SELECT
      (SELECT n FROM fresh_breaches) AS fresh_breaches,
      (SELECT count(*)::integer FROM task_owner t CROSS JOIN me
       WHERE t.owner_at_deadline = auth.uid() AND t.status = 'pending' AND t.scheduled_at < now()) AS overdue_followups,
      (SELECT count(*)::integer FROM task_owner t CROSS JOIN me
       WHERE t.owner_at_deadline = auth.uid() AND t.status = 'pending'
         AND t.scheduled_at < now() - interval '24 hours') AS followups_past_grace,
      (SELECT count(*)::integer FROM public.lead_followups lf CROSS JOIN day_bounds d
       WHERE lf.user_id = auth.uid() AND lf.status = 'completed'
         AND lf.completed_at >= d.day_start AND lf.completed_at < d.next_day
         AND lf.type IS DISTINCT FROM 'cold_followup'
         AND lf.completed_at <= lf.scheduled_at + interval '24 hours') AS followups_completed_on_time_today,
      (SELECT count(*)::integer FROM task_owner t CROSS JOIN day_bounds d
       WHERE t.owner_at_deadline = auth.uid() AND t.status = 'completed'
         AND t.completed_at >= d.day_start AND t.completed_at < d.next_day
         AND t.completed_at > t.scheduled_at + interval '24 hours') AS followups_completed_late_today,
      (SELECT count(*)::integer FROM public.campus_visits cv
       JOIN public.leads l ON l.id = cv.lead_id CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id AND l.archived_at IS NULL
         AND cv.status IN ('scheduled', 'confirmed') AND cv.visit_date < now()) AS overdue_visit_outcomes,
      (SELECT count(*)::integer FROM public.campus_visits cv
       JOIN public.leads l ON l.id = cv.lead_id CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id AND l.archived_at IS NULL
         AND cv.status = 'completed' AND cv.visit_date < now() - interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = cv.lead_id AND cl.called_at > cv.visit_date)
         AND NOT EXISTS (SELECT 1 FROM public.lead_followups done WHERE done.lead_id = cv.lead_id
           AND done.status = 'completed' AND done.completed_at > cv.visit_date)) AS overdue_post_visit_followups
  )
  SELECT jsonb_build_object(
    'as_of', now(), 'timezone', 'Asia/Kolkata', 'policy_version', 'shadow-v1-owner-at-breach',
    'payout_effect', false, 'completion_points', 5, 'delay_penalty_points', 2,
    'fresh_breaches', c.fresh_breaches, 'overdue_followups', c.overdue_followups,
    'followups_past_grace', c.followups_past_grace,
    'followups_completed_on_time_today', c.followups_completed_on_time_today,
    'followups_completed_late_today', c.followups_completed_late_today,
    'overdue_visit_outcomes', c.overdue_visit_outcomes,
    'overdue_post_visit_followups', c.overdue_post_visit_followups,
    'points_at_risk', 2 * (c.fresh_breaches + c.followups_past_grace + c.followups_completed_late_today + c.overdue_visit_outcomes + c.overdue_post_visit_followups),
    'points_earned_today', 5 * c.followups_completed_on_time_today,
    'shadow_score_today', (5 * c.followups_completed_on_time_today)
      - (2 * (c.fresh_breaches + c.followups_past_grace + c.followups_completed_late_today + c.overdue_visit_outcomes + c.overdue_post_visit_followups))
  ) FROM counts c;
$$;

REVOKE ALL ON FUNCTION public.counsellor_crm_reliability_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counsellor_crm_reliability_snapshot() TO authenticated;
