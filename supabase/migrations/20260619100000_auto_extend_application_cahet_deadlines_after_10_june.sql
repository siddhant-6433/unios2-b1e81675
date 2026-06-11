-- Keep the current Round 1 deadline at 10 June 2026 through the end of
-- 10 June IST, then automatically expose the final extension deadline:
-- 14 June 2026 11:59 PM IST.

INSERT INTO public._app_config (key, value)
VALUES ('fee_submission_deadline', '2026-06-10')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_applicant_deadlines()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN key = 'fee_submission_deadline'
        AND value::date <= DATE '2026-06-10'
        AND now() > '2026-06-10 23:59:59+05:30'::timestamptz
      THEN '2026-06-14'
      ELSE value
    END
  )
  INTO v_result
  FROM public._app_config
  WHERE key IN ('fee_submission_deadline', 'full_course_payment_deadline');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_applicant_deadlines() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cahet_sprint_stats(
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  own_count int,
  own_today int,
  team_count int,
  team_today int,
  pool_total int,
  pool_remaining int,
  deadline_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pool AS (SELECT lead_id FROM public.cahet_bpt_bmrit_leads),
  regs AS (SELECT * FROM public.cahet_registrations)
  SELECT
    COALESCE((SELECT COUNT(*)::int FROM regs WHERE registered_by = p_counsellor_id), 0) AS own_count,
    COALESCE((SELECT COUNT(*)::int FROM regs
              WHERE registered_by = p_counsellor_id
                AND registered_at >= date_trunc('day', now())), 0) AS own_today,
    (SELECT COUNT(*)::int FROM regs) AS team_count,
    (SELECT COUNT(*)::int FROM regs WHERE registered_at >= date_trunc('day', now())) AS team_today,
    (SELECT COUNT(*)::int FROM pool) AS pool_total,
    (SELECT COUNT(*)::int FROM pool po
       WHERE NOT EXISTS (SELECT 1 FROM regs r WHERE r.lead_id = po.lead_id)) AS pool_remaining,
    CASE
      WHEN now() > '2026-06-10 23:59:59+05:30'::timestamptz
      THEN '2026-06-14 23:59:59+05:30'::timestamptz
      ELSE '2026-06-10 23:59:59+05:30'::timestamptz
    END AS deadline_at;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_stats(uuid) TO authenticated;
