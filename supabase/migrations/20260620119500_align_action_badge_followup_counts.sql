-- Keep every-page follow-up badges aligned with the Pending Follow-ups page.
--
-- The destination page intentionally buckets follow-ups as:
--   overdue  = before today
--   today    = today, due up to now
--   upcoming = future rows through the next 7 days
-- The action badge hot path previously used scheduled_at < now(), so same-day
-- pending rows could appear as "Overdue Follow-ups" in the top bar while the
-- Pending Follow-ups page showed them under Today or Upcoming.

CREATE OR REPLACE FUNCTION public.followup_badge_bucket_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false
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
      CASE WHEN role_name = 'counsellor' THEN false ELSE COALESCE(p_scope_unassigned, false) END AS unassigned_only
    FROM auth_scope
  ),
  bounds AS (
    SELECT
      date_trunc('day', now()) AS today_start,
      now() AS current_time,
      date_trunc('day', now()) + interval '7 days' AS week_end
  ),
  scoped_leads AS (
    SELECT l.id
    FROM public.leads l
    CROSS JOIN scope s
    WHERE l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
      AND (s.counsellor_id IS NULL OR l.counsellor_id = s.counsellor_id)
      AND (s.unassigned_only = false OR l.counsellor_id IS NULL)
  ),
  followup_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue,
      COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at <= b.current_time)::integer AS today,
      COUNT(*) FILTER (WHERE lf.scheduled_at > b.current_time AND lf.scheduled_at <= b.week_end)::integer AS upcoming
    FROM public.lead_followups lf
    JOIN scoped_leads l ON l.id = lf.lead_id
    CROSS JOIN bounds b
    WHERE lf.status = 'pending'
  )
SELECT jsonb_build_object(
  'overdue', CASE WHEN public.get_overdue_followup_enforcement_enabled() THEN COALESCE(fc.overdue, 0) ELSE 0 END,
  'today', COALESCE(fc.today, 0),
  'upcoming', COALESCE(fc.upcoming, 0)
)
FROM followup_counts fc;
$$;

GRANT EXECUTE ON FUNCTION public.followup_badge_bucket_counts(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_followups jsonb;
  v_base_overdue integer;
  v_overdue integer;
  v_today integer;
  v_tat_defaults integer;
  v_wa_unread integer;
BEGIN
  v_payload := public.action_badge_counts_base(p_scope_counsellor_id, p_include_unassigned);
  v_followups := public.followup_badge_bucket_counts(p_scope_counsellor_id, false);

  v_base_overdue := COALESCE((v_payload->>'overdue')::integer, 0);
  v_overdue := COALESCE((v_followups->>'overdue')::integer, 0);
  v_today := COALESCE((v_followups->>'today')::integer, 0);

  v_tat_defaults := GREATEST(
    COALESCE((v_payload->>'tat_defaults')::integer, 0) - v_base_overdue + v_overdue,
    0
  );

  v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdue}', to_jsonb(v_overdue), true);
  v_payload := jsonb_set(v_payload, '{today}', to_jsonb(v_today), true);
  v_payload := jsonb_set(v_payload, '{tat_defaults}', to_jsonb(v_tat_defaults), true);

  v_wa_unread := public.whatsapp_unreplied_message_count(p_scope_counsellor_id, p_include_unassigned);
  v_payload := jsonb_set(v_payload, '{wa_unread}', to_jsonb(v_wa_unread), true);

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
