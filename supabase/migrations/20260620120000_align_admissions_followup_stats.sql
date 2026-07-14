-- Admissions CRM uses admissions_stats for its follow-up alert banner. Keep
-- those fields aligned with Pending Follow-ups and the global action badges.

DO $$
BEGIN
  IF to_regprocedure('public.admissions_stats_base(uuid, uuid)') IS NULL
     AND to_regprocedure('public.admissions_stats(uuid, uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.admissions_stats(uuid, uuid)
    RENAME TO admissions_stats_base;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admissions_followup_bucket_counts(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
      AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
      AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
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
  'pending_followups',
    CASE
      WHEN public.get_overdue_followup_enforcement_enabled()
        THEN COALESCE(fc.overdue, 0) + COALESCE(fc.today, 0) + COALESCE(fc.upcoming, 0)
      ELSE COALESCE(fc.today, 0) + COALESCE(fc.upcoming, 0)
    END,
  'overdue_followups',
    CASE WHEN public.get_overdue_followup_enforcement_enabled() THEN COALESCE(fc.overdue, 0) ELSE 0 END,
  'today_followups', COALESCE(fc.today, 0)
)
FROM followup_counts fc;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_followup_bucket_counts(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admissions_stats(
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
  v_payload jsonb;
  v_followups jsonb;
BEGIN
  v_payload := public.admissions_stats_base(p_counsellor_id, p_campus_id);
  v_followups := public.admissions_followup_bucket_counts(p_counsellor_id, p_campus_id);

  v_payload := jsonb_set(
    COALESCE(v_payload, '{}'::jsonb),
    '{pending_followups}',
    to_jsonb(COALESCE((v_followups->>'pending_followups')::integer, 0)),
    true
  );
  v_payload := jsonb_set(
    v_payload,
    '{overdue_followups}',
    to_jsonb(COALESCE((v_followups->>'overdue_followups')::integer, 0)),
    true
  );
  v_payload := jsonb_set(
    v_payload,
    '{today_followups}',
    to_jsonb(COALESCE((v_followups->>'today_followups')::integer, 0)),
    true
  );

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_stats(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
