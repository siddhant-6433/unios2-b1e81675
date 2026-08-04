-- A call list only counts calls placed by its OWN assignee.
--
-- assigned_at (20260802100814) fixed the previous-cycle leak: a call made before
-- the hand-off can no longer be reported as this cycle's outcome. It did not fix
-- attribution. One lead sitting in two active call lists is still marked worked
-- in BOTH the moment either counsellor dials it, so list B shows a call its own
-- counsellor never made.
--
-- Now the credit follows the caller: call_logs.user_id must resolve to the
-- member's assigned_to. call_logs.user_id is populated and resolves to a profile
-- on every row written in the last 30 days (2,783/2,783 across cloud_dialer,
-- manual_log and legacy NULL-source rows), so nothing is stranded pending by
-- this tightening.
--
-- Tradeoff, deliberate: a lead in two lists assigned to two counsellors now gets
-- dialled twice — each list only clears on its own assignee's call. That is the
-- requested semantics (per-list accountability) rather than global de-duplication.
-- If duplicate dials become the bigger problem, the lever is to stop putting the
-- same lead in two concurrently-assigned lists, not to re-broaden this rule.

-- ── 1. Only the assignee's own call marks their member worked ────────────────

CREATE OR REPLACE FUNCTION public.fn_cleanup_cloud_dialer_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_profile_id uuid;
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.lead_id IS NOT NULL THEN
    DELETE FROM public.cloud_dialer_pins
     WHERE user_id = NEW.user_id AND lead_id = NEW.lead_id;
  END IF;

  IF NEW.lead_id IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    SELECT p.id INTO v_caller_profile_id
    FROM public.profiles p
    WHERE p.user_id = NEW.user_id
    LIMIT 1;

    IF v_caller_profile_id IS NOT NULL THEN
      UPDATE public.lead_list_members m
         SET work_status = 'worked',
             worked_at = now(),
             call_log_id = NEW.id
        FROM public.lead_lists ll
       WHERE ll.id = m.list_id
         AND ll.purpose = 'calling'
         AND ll.is_active
         AND m.lead_id = NEW.lead_id
         AND m.work_status = 'pending'
         -- Credit follows the caller: another counsellor's call does not clear
         -- this member.
         AND m.assigned_to = v_caller_profile_id
         -- A backdated call row predates the hand-off: previous cycle, not this one.
         AND (m.assigned_at IS NULL OR COALESCE(NEW.called_at, now()) >= m.assigned_at);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Per-list progress: same attribution rule ──────────────────────────────

CREATE OR REPLACE FUNCTION public.call_list_progress(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT * FROM public.lead_list_members m WHERE m.list_id = p_list_id
  ),
  latest_call AS (
    SELECT DISTINCT ON (m.lead_id) m.lead_id, cl.disposition, cl.called_at
    FROM members m
    JOIN public.profiles cp ON cp.id = m.assigned_to
    JOIN public.call_logs cl
      ON cl.lead_id = m.lead_id
     AND cl.user_id = cp.user_id
     AND (m.assigned_at IS NULL OR cl.called_at >= m.assigned_at)
    WHERE m.work_status = 'worked'
    ORDER BY m.lead_id, cl.called_at DESC
  )
  SELECT jsonb_build_object(
    'list_id', p_list_id,
    'total',   (SELECT count(*)::int FROM members),
    'pending', (SELECT count(*) FILTER (WHERE work_status = 'pending')::int FROM members),
    'worked',  (SELECT count(*) FILTER (WHERE work_status = 'worked')::int  FROM members),
    'skipped', (SELECT count(*) FILTER (WHERE work_status = 'skipped')::int FROM members),
    'last_call_at', (SELECT max(called_at) FROM latest_call),
    'dispositions', COALESCE((
      SELECT jsonb_object_agg(COALESCE(disposition, 'unrecorded'), n ORDER BY n DESC)
      FROM (SELECT disposition, count(*)::int AS n FROM latest_call GROUP BY disposition) z
    ), '{}'::jsonb),
    'by_counsellor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'total',   c.total,
        'worked',  c.worked,
        'pending', c.pending
      ) ORDER BY c.pending DESC)
      FROM (
        SELECT m2.assigned_to,
               count(*)::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM members m2
        WHERE m2.assigned_to IS NOT NULL
        GROUP BY m2.assigned_to
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated;
