-- The Admissions CRM alert banner must match the destination page it links to.
-- For counsellor-scoped views, reuse pending_followups_payload so the banner
-- and /pending-followups?tab=overdue share auth scoping and bucket semantics.

CREATE OR REPLACE FUNCTION public.admissions_followup_bucket_counts(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role_name text;
  v_page_payload jsonb;
  v_page_counts jsonb;
  v_overdue integer := 0;
  v_today integer := 0;
  v_upcoming integer := 0;
BEGIN
  v_role_name := public.get_user_role(auth.uid())::text;

  IF v_role_name = 'counsellor' OR p_counsellor_id IS NOT NULL THEN
    v_page_payload := public.pending_followups_payload(
      'overdue',
      p_counsellor_id,
      false,
      0,
      1
    );
    v_page_counts := COALESCE(v_page_payload->'counts', '{}'::jsonb);
    v_overdue := COALESCE((v_page_counts->>'overdue')::integer, 0);
    v_today := COALESCE((v_page_counts->>'today')::integer, 0);
    v_upcoming := COALESCE((v_page_counts->>'upcoming')::integer, 0);

    RETURN jsonb_build_object(
      'pending_followups', v_overdue + v_today + v_upcoming,
      'overdue_followups', v_overdue,
      'today_followups', v_today
    );
  END IF;

  WITH
    bounds AS (
      SELECT
        date_trunc('day', now()) AS today_start,
        now() AS current_time,
        date_trunc('day', now()) + interval '7 days' AS week_end
    ),
    scoped_leads AS (
      SELECT l.id
      FROM public.leads l
      WHERE l.is_mirror = false
        AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
        AND (p_campus_id IS NULL OR l.campus_id = p_campus_id)
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
  SELECT
    CASE WHEN public.get_overdue_followup_enforcement_enabled() THEN COALESCE(fc.overdue, 0) ELSE 0 END,
    COALESCE(fc.today, 0),
    COALESCE(fc.upcoming, 0)
  INTO v_overdue, v_today, v_upcoming
  FROM followup_counts fc;

  RETURN jsonb_build_object(
    'pending_followups',
      CASE
        WHEN public.get_overdue_followup_enforcement_enabled()
          THEN v_overdue + v_today + v_upcoming
        ELSE v_today + v_upcoming
      END,
    'overdue_followups',
      CASE WHEN public.get_overdue_followup_enforcement_enabled() THEN v_overdue ELSE 0 END,
    'today_followups', v_today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_followup_bucket_counts(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
