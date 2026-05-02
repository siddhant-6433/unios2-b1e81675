-- Fix: get_counsellor_performance_stats times out due to multiple LEFT JOINs
-- on large tables. Rewrite as separate count queries per metric (much faster).

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS counsellor_id,
    p.display_name AS counsellor_name,
    p.user_id,
    -- Each metric as a scalar subquery (avoids explosive LEFT JOIN)
    (SELECT COUNT(*) FROM public.call_logs cl WHERE cl.user_id = p.user_id)::bigint AS total_calls,
    (SELECT COUNT(*) FROM public.lead_activities la WHERE la.user_id = p.user_id AND la.type = 'whatsapp')::bigint AS total_whatsapps,
    (SELECT COUNT(*) FROM public.lead_followups lf WHERE lf.user_id = p.user_id AND lf.status = 'completed')::bigint AS followups_completed,
    (SELECT COUNT(*) FROM public.lead_followups lf WHERE lf.user_id = p.user_id AND lf.status = 'pending' AND lf.scheduled_at < now())::bigint AS followups_overdue,
    (SELECT COUNT(*) FROM public.campus_visits cv WHERE cv.scheduled_by = p.id)::bigint AS visits_scheduled,
    (SELECT COUNT(*) FROM public.leads l WHERE l.counsellor_id = p.id)::bigint AS leads_assigned,
    (SELECT COUNT(*) FROM public.leads l WHERE l.counsellor_id = p.id AND l.stage = 'admitted')::bigint AS conversions
  FROM public.profiles p
  INNER JOIN public.user_roles ur ON ur.user_id = p.user_id
    AND ur.role IN ('counsellor', 'admission_head')
  ORDER BY p.display_name;
END;
$$;
