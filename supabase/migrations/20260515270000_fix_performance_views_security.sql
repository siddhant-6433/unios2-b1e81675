-- Fix: counsellor_performance_stats and counsellor_leaderboard views return empty
-- because RLS on underlying tables (leads, call_logs, user_roles etc.) blocks access
-- during view execution. Convert to SECURITY DEFINER functions that return table rows.

-- 1. counsellor_performance_stats as SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.get_counsellor_performance_stats()
RETURNS TABLE (
  counsellor_id uuid,
  counsellor_name text,
  user_id uuid,
  total_calls bigint,
  total_whatsapps bigint,
  followups_completed bigint,
  followups_overdue bigint,
  visits_scheduled bigint,
  leads_assigned bigint,
  conversions bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS counsellor_id,
    p.display_name AS counsellor_name,
    p.user_id,
    COUNT(DISTINCT cl.id) AS total_calls,
    COUNT(DISTINCT la_wa.id) AS total_whatsapps,
    COUNT(DISTINCT lf.id) FILTER (WHERE lf.status = 'completed') AS followups_completed,
    COUNT(DISTINCT lf_od.id) AS followups_overdue,
    COUNT(DISTINCT cv.id) AS visits_scheduled,
    COUNT(DISTINCT l.id) AS leads_assigned,
    COUNT(DISTINCT l.id) FILTER (WHERE l.stage = 'admitted') AS conversions
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.user_id
    AND ur.role IN ('counsellor', 'admission_head', 'super_admin', 'campus_admin')
  LEFT JOIN public.leads l ON l.counsellor_id = p.id
  LEFT JOIN public.call_logs cl ON cl.user_id = p.user_id
  LEFT JOIN public.lead_activities la_wa ON la_wa.user_id = p.user_id AND la_wa.type = 'whatsapp'
  LEFT JOIN public.lead_followups lf ON lf.user_id = p.user_id
  LEFT JOIN public.lead_followups lf_od ON lf_od.user_id = p.user_id AND lf_od.status = 'pending' AND lf_od.scheduled_at < now()
  LEFT JOIN public.campus_visits cv ON cv.scheduled_by = p.id
  GROUP BY p.id, p.display_name, p.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_counsellor_performance_stats() TO authenticated;

-- 2. counsellor_leaderboard as SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.get_counsellor_leaderboard()
RETURNS TABLE (
  counsellor_id uuid,
  counsellor_name text,
  user_id uuid,
  total_score integer,
  weekly_score integer,
  monthly_score integer,
  daily_score integer,
  positive_actions integer,
  negative_actions integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS counsellor_id,
    p.display_name AS counsellor_name,
    p.user_id,
    COALESCE(SUM(cse.points), 0)::integer AS total_score,
    COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= date_trunc('week', now())), 0)::integer AS weekly_score,
    COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= date_trunc('month', now())), 0)::integer AS monthly_score,
    COALESCE(SUM(cse.points) FILTER (WHERE cse.created_at >= now() - interval '1 day'), 0)::integer AS daily_score,
    COUNT(*) FILTER (WHERE cse.points > 0)::integer AS positive_actions,
    COUNT(*) FILTER (WHERE cse.points < 0)::integer AS negative_actions
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role IN ('counsellor', 'admission_head')
  LEFT JOIN public.counsellor_score_events cse ON cse.counsellor_id = p.id
  GROUP BY p.id, p.display_name, p.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_counsellor_leaderboard() TO authenticated;
