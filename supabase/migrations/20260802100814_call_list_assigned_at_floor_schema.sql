-- Calls from a previous cycle must never count as this cycle's call updates.
--
-- Until now the only guard was lead_list_members.work_status = 'worked', and the
-- disposition join was `call_logs cl ON cl.lead_id = m.lead_id` with NO time
-- floor — it took the newest call for that lead whenever it happened.
--
-- That leaks in a real case: one lead sitting in two active call lists. When
-- counsellor A dials it, the call_logs trigger marks the lead worked in BOTH
-- lists, so list B reports A's call as its own outcome even though list B's
-- counsellor never dialled. The same shape lets a stale pre-assignment call
-- surface as a fresh result, and get_lead_list_assignment_report's per-lead
-- "Latest Call" column had the identical problem — a months-old disposition
-- could show as the result of a list assigned this morning.
--
-- Fix: stamp the hand-off time on the member row and floor every reader on it.

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN public.lead_list_members.assigned_at IS
  'When this member was handed to assigned_to. Calls before this instant belong to a previous cycle and are never counted as this cycle''s outcome.';

CREATE INDEX IF NOT EXISTS idx_llm_assigned_at
  ON public.lead_list_members (list_id, assigned_at)
  WHERE assigned_at IS NOT NULL;

-- ── 2. Only a post-assignment call marks a member worked ─────────────────────

CREATE OR REPLACE FUNCTION public.fn_cleanup_cloud_dialer_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.lead_id IS NOT NULL THEN
    DELETE FROM public.cloud_dialer_pins
     WHERE user_id = NEW.user_id AND lead_id = NEW.lead_id;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
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
       -- A backdated call row predates the hand-off: previous cycle, not this one.
       AND (m.assigned_at IS NULL OR COALESCE(NEW.called_at, now()) >= m.assigned_at);
  END IF;

  RETURN NEW;
END;
$$;

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
    JOIN public.call_logs cl
      ON cl.lead_id = m.lead_id
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
