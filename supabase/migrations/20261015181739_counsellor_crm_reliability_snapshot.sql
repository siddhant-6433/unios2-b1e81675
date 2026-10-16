-- keep-migration-version: already recorded on production schema_migrations
-- counsellor crm reliability snapshot

-- Counsellor-only, advisory service-reliability snapshot.
-- Versioned scoring is intentionally separate from the monthly incentive ledger.
CREATE OR REPLACE FUNCTION public.counsellor_crm_reliability_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH me AS MATERIALIZED (
    SELECT p.id AS profile_id
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
    LIMIT 1
  ),
  day_bounds AS (
    SELECT
      (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS day_start,
      ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day') AT TIME ZONE 'Asia/Kolkata') AS next_day
  ),
  counts AS (
    SELECT
      (SELECT count(*)::integer
       FROM public.leads l
       LEFT JOIN public.source_sla_config sla ON sla.source = l.source::text
       CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND l.stage = 'new_lead'
         AND l.first_contact_at IS NULL
         AND l.assigned_at IS NOT NULL
         AND now() > l.assigned_at + make_interval(hours => COALESCE(sla.first_contact_hours, 4))
      ) AS fresh_breaches,
      (SELECT count(*)::integer
       FROM public.lead_followups lf
       JOIN public.leads l ON l.id = lf.lead_id
       CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND lf.status = 'pending'
         AND lf.type IS DISTINCT FROM 'cold_followup'
         AND lf.scheduled_at < now()
      ) AS overdue_followups,
      (SELECT count(*)::integer
       FROM public.lead_followups lf
       JOIN public.leads l ON l.id = lf.lead_id
       CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND lf.status = 'pending'
         AND lf.type IS DISTINCT FROM 'cold_followup'
         AND lf.scheduled_at < now() - interval '24 hours'
      ) AS followups_past_grace,
      (SELECT count(*)::integer
       FROM public.lead_followups lf
       JOIN public.leads l ON l.id = lf.lead_id
       CROSS JOIN me, day_bounds d
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND lf.status = 'completed'
         AND lf.completed_at >= d.day_start
         AND lf.completed_at < d.next_day
         AND lf.type IS DISTINCT FROM 'cold_followup'
         AND lf.completed_at <= lf.scheduled_at + interval '24 hours'
      ) AS followups_completed_on_time_today,
      (SELECT count(*)::integer
       FROM public.lead_followups lf
       JOIN public.leads l ON l.id = lf.lead_id
       CROSS JOIN me, day_bounds d
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND lf.status = 'completed'
         AND lf.completed_at >= d.day_start
         AND lf.completed_at < d.next_day
         AND lf.type IS DISTINCT FROM 'cold_followup'
         AND lf.completed_at > lf.scheduled_at + interval '24 hours'
      ) AS followups_completed_late_today,
      (SELECT count(*)::integer
       FROM public.campus_visits cv
       JOIN public.leads l ON l.id = cv.lead_id
       CROSS JOIN me
       WHERE l.counsellor_id = me.profile_id
         AND l.archived_at IS NULL
         AND cv.status IN ('scheduled', 'confirmed')
         AND cv.visit_date < now()
      ) AS overdue_visit_outcomes,
      (SELECT count(*)::integer
       FROM public.post_visit_pending_followups pv
       CROSS JOIN me
       WHERE pv.counsellor_id = me.profile_id
         AND pv.visit_date < now() - interval '24 hours'
      ) AS overdue_post_visit_followups
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'timezone', 'Asia/Kolkata',
    'policy_version', 'shadow-v1',
    'payout_effect', false,
    'completion_points', 5,
    'delay_penalty_points', 2,
    'fresh_breaches', c.fresh_breaches,
    'overdue_followups', c.overdue_followups,
    'followups_past_grace', c.followups_past_grace,
    'followups_completed_on_time_today', c.followups_completed_on_time_today,
    'followups_completed_late_today', c.followups_completed_late_today,
    'overdue_visit_outcomes', c.overdue_visit_outcomes,
    'overdue_post_visit_followups', c.overdue_post_visit_followups,
    'points_at_risk', 2 * (
      c.fresh_breaches
      + c.followups_past_grace
      + c.followups_completed_late_today
      + c.overdue_visit_outcomes
      + c.overdue_post_visit_followups
    ),
    'points_earned_today', 5 * c.followups_completed_on_time_today,
    'shadow_score_today',
      (5 * c.followups_completed_on_time_today)
      - (2 * (c.fresh_breaches + c.followups_past_grace + c.followups_completed_late_today + c.overdue_visit_outcomes + c.overdue_post_visit_followups))
  )
  FROM counts c;
$$;

REVOKE ALL ON FUNCTION public.counsellor_crm_reliability_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counsellor_crm_reliability_snapshot() TO authenticated;
