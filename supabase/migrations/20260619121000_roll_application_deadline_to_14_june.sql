-- Align all applicant-facing portals with the current admissions deadline:
-- 14 June 2026 11:59 PM IST, then automatically roll to the five-day
-- extension windows. Round labels are computed in the frontend: Round 2
-- covers 14, 19, and 24 June; Round 3 begins on 29 June.
--
-- CAHET is separate from the general admissions deadline. It follows ABVMU's
-- published date and should only be changed when ABVMU extends it.

INSERT INTO public._app_config (key, value)
VALUES ('fee_submission_deadline', '2026-06-14')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

INSERT INTO public._app_config (key, value)
VALUES ('cahet_registration_deadline', '2026-06-14')
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
      THEN GREATEST(
        value::date,
        (
          DATE '2026-06-14'
          + (
            CEIL(
              GREATEST(
                0,
                EXTRACT(epoch FROM (now() - '2026-06-14 23:59:59+05:30'::timestamptz))
              ) / (5 * 86400.0)
            )::int * 5
          )
        )
      )::text
      ELSE value
    END
  )
  INTO v_result
  FROM public._app_config
  WHERE key IN (
    'fee_submission_deadline',
    'full_course_payment_deadline',
    'cahet_registration_deadline',
    'loan_letter_bank_beneficiary_name',
    'loan_letter_bank_name',
    'loan_letter_bank_account_no',
    'loan_letter_bank_ifsc',
    'loan_letter_bank_branch',
    'loan_letter_bank_upi_id'
  );

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
  regs AS (SELECT * FROM public.cahet_registrations),
  deadline AS (
    SELECT COALESCE(
      (SELECT value::date FROM public._app_config WHERE key = 'cahet_registration_deadline'),
      DATE '2026-06-14'
    ) AS deadline_date
  )
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
    (deadline.deadline_date::text || ' 23:59:59+05:30')::timestamptz AS deadline_at
  FROM deadline;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_stats(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
