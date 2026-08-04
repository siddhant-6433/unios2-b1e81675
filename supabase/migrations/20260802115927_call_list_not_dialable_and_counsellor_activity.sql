-- 1. An assigned call list must be completable.
--
-- cloud_dialer_campaign_queue excludes members whose lead has no phone or sits
-- in a terminal stage (cold / not_interested / rejected / dnc / ineligible /
-- admitted) — correct, nobody should dial those. But progress counted them in
-- the denominator, so the first real assignment ("BBA Meta Leads", 38 members,
-- 13 of them cold/not_interested/rejected) showed "0/38 called · 38 left" over a
-- queue of 25. The counsellor works all 25, the list sticks at 25/38 forever,
-- and the assigner's dashboard shows it permanently incomplete.
--
-- Fix: those members get their own work_status, 'not_dialable', assigned at
-- hand-off time. They stay visible in the total (the assigner picked them) but
-- leave the pending count, so the list can actually reach done.
--
-- Deliberately NOT reusing 'skipped': "my counsellor skipped 13" and "13 were
-- already closed" are different facts and the assigner needs to tell them apart.
--
-- 2. Counsellor activity for the assign picker (see the RPC at the bottom).

ALTER TABLE public.lead_list_members DROP CONSTRAINT IF EXISTS lead_list_members_work_status_check;
ALTER TABLE public.lead_list_members
  ADD CONSTRAINT lead_list_members_work_status_check
  CHECK (work_status IN ('pending', 'worked', 'skipped', 'not_dialable'));

COMMENT ON COLUMN public.lead_list_members.work_status IS
  'pending = still to be called. worked = the assignee placed a call after assigned_at. skipped = the assignee explicitly skipped it in the dialer. not_dialable = no phone or terminal stage at hand-off, so it never enters the queue.';

-- ── Backfill: mark undialable members on already-assigned lists ──────────────
-- Safe to re-run; only touches rows still 'pending'.

UPDATE public.lead_list_members m
   SET work_status = 'not_dialable'
  FROM public.lead_lists ll, public.leads l
 WHERE ll.id = m.list_id
   AND ll.purpose = 'calling'
   AND l.id = m.lead_id
   AND m.work_status = 'pending'
   AND (l.phone IS NULL
        OR l.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'));

-- ── Stamp not_dialable at assignment time ───────────────────────────────────
-- Runs as a statement inside assign_lead_list_round_robin. Kept as its own
-- helper so the assignment function stays readable and this rule lives in one
-- place.

CREATE OR REPLACE FUNCTION public.mark_call_list_undialable(_list_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH marked AS (
    UPDATE public.lead_list_members m
       SET work_status = 'not_dialable'
      FROM public.leads l
     WHERE m.list_id = _list_id
       AND l.id = m.lead_id
       AND m.work_status = 'pending'
       AND (l.phone IS NULL
            OR l.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'))
    RETURNING 1
  )
  SELECT count(*)::integer FROM marked;
$$;

REVOKE ALL ON FUNCTION public.mark_call_list_undialable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_call_list_undialable(uuid) TO authenticated;

-- ── Readers: report not_dialable separately ─────────────────────────────────

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
    -- dialable is the honest denominator: what the counsellor can actually work.
    'dialable', (SELECT count(*) FILTER (WHERE work_status <> 'not_dialable')::int FROM members),
    'pending', (SELECT count(*) FILTER (WHERE work_status = 'pending')::int FROM members),
    'worked',  (SELECT count(*) FILTER (WHERE work_status = 'worked')::int  FROM members),
    'skipped', (SELECT count(*) FILTER (WHERE work_status = 'skipped')::int FROM members),
    'not_dialable', (SELECT count(*) FILTER (WHERE work_status = 'not_dialable')::int FROM members),
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
               count(*) FILTER (WHERE m2.work_status <> 'not_dialable')::int AS total,
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

CREATE OR REPLACE FUNCTION public.my_call_lists()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.due_date NULLS LAST, x.pending DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT
      ll.id,
      ll.name,
      ll.priority_note,
      ll.due_date,
      count(*)::int                                                     AS total,
      count(*) FILTER (WHERE m.work_status <> 'not_dialable')::int      AS dialable,
      count(*) FILTER (WHERE m.work_status = 'pending')::int            AS pending,
      count(*) FILTER (WHERE m.work_status = 'worked')::int             AS worked,
      count(*) FILTER (WHERE m.work_status = 'skipped')::int            AS skipped,
      count(*) FILTER (WHERE m.work_status = 'not_dialable')::int       AS not_dialable,
      max(m.worked_at)                                                  AS last_worked_at
    FROM public.lead_lists ll
    JOIN public.lead_list_members m ON m.list_id = ll.id
    WHERE ll.purpose = 'calling'
      AND ll.is_active
      AND (v_is_admin OR m.assigned_to = v_profile_id)
    GROUP BY ll.id, ll.name, ll.priority_note, ll.due_date
    HAVING count(*) FILTER (WHERE m.work_status = 'pending') > 0
        OR max(m.worked_at) > now() - interval '7 days'
  ) x;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.my_call_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_call_lists() TO authenticated;

-- ── Counsellor activity for the assign picker ───────────────────────────────
-- login_disabled = false is a poor proxy for "active": three counsellors with
-- 1,500+ open leads between them have not placed a call since mid-June, and a
-- "Test Counsellor" account is a selectable target. Rather than guessing who is
-- on leave, surface the fact and let the assigner decide.

CREATE OR REPLACE FUNCTION public.assignable_counsellors()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'name', x.name,
           'last_call_at', x.last_call_at,
           'open_leads', x.open_leads,
           'pending_call_list', x.pending_call_list
         ) ORDER BY x.name), '[]'::jsonb)
  FROM (
    SELECT p.id,
           COALESCE(p.display_name, 'Unknown')::text AS name,
           (SELECT max(cl.called_at) FROM public.call_logs cl WHERE cl.user_id = p.user_id) AS last_call_at,
           (SELECT count(*)::int FROM public.leads l WHERE l.counsellor_id = p.id) AS open_leads,
           (SELECT count(*)::int
              FROM public.lead_list_members m
              JOIN public.lead_lists ll ON ll.id = m.list_id AND ll.purpose = 'calling' AND ll.is_active
             WHERE m.assigned_to = p.id AND m.work_status = 'pending') AS pending_call_list
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'counsellor'::public.app_role
      AND COALESCE(p.login_disabled, false) = false
  ) x;
$$;

REVOKE ALL ON FUNCTION public.assignable_counsellors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assignable_counsellors() TO authenticated;

COMMENT ON FUNCTION public.assignable_counsellors() IS
  'Counsellors eligible for list assignment, with last-call time, open lead count and outstanding call-list workload so the assigner can avoid dormant or already-loaded people.';

-- ── Assignment stamps not_dialable as part of the hand-off ──────────────────
-- Otherwise the flag only exists for lists that happen to get backfilled.

CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin(
  _list_id uuid,
  _counsellor_ids uuid[],
  _only_unassigned boolean DEFAULT false,
  _priority_note text DEFAULT NULL,
  _due_date date DEFAULT NULL
)
RETURNS TABLE (
  batch_id uuid,
  counsellor_id uuid,
  counsellor_name text,
  assigned_count integer,
  failed_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_team_leader boolean;
  v_list_name text;
  v_batch_id uuid;
  v_total_leads integer := 0;
  v_assigned_count integer := 0;
  v_valid_counsellor_count integer := 0;
  v_now timestamptz := now();
BEGIN
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _list_id IS NULL THEN
    RAISE EXCEPTION 'List is required';
  END IF;

  IF COALESCE(array_length(_counsellor_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one counsellor is required';
  END IF;

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_user_id
  LIMIT 1;

  v_is_admin := public.has_role(v_caller_user_id, 'super_admin'::public.app_role)
                OR public.has_role(v_caller_user_id, 'admission_head'::public.app_role)
                OR public.has_role(v_caller_user_id, 'principal'::public.app_role);

  v_is_team_leader := EXISTS (
    SELECT 1 FROM public.teams t WHERE t.leader_id = v_caller_profile_id
  );

  IF NOT (v_is_admin OR v_is_team_leader) THEN
    RAISE EXCEPTION 'Insufficient permissions to assign lead lists';
  END IF;

  SELECT l.name INTO v_list_name FROM public.lead_lists l WHERE l.id = _list_id;
  IF v_list_name IS NULL THEN
    RAISE EXCEPTION 'Lead list not found';
  END IF;

  WITH requested AS (
    SELECT DISTINCT x.counsellor_id
    FROM unnest(_counsellor_ids) AS x(counsellor_id)
    WHERE x.counsellor_id IS NOT NULL
  ),
  valid AS (
    SELECT p.id
    FROM requested r
    JOIN public.profiles p ON p.id = r.counsellor_id
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'counsellor'::public.app_role
      AND COALESCE(p.login_disabled, false) = false
      AND (
        v_is_admin
        OR p.id = v_caller_profile_id
        OR EXISTS (
          SELECT 1
          FROM public.teams t
          JOIN public.team_members tm ON tm.team_id = t.id
          JOIN public.profiles member ON member.user_id = tm.user_id
          WHERE t.leader_id = v_caller_profile_id
            AND member.id = p.id
        )
      )
  )
  SELECT count(*) INTO v_valid_counsellor_count FROM valid;

  IF v_valid_counsellor_count <> (
    SELECT count(DISTINCT id) FROM unnest(_counsellor_ids) AS ids(id) WHERE id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more selected counsellors are outside your assignment scope';
  END IF;

  UPDATE public.lead_lists
     SET purpose = 'calling',
         is_active = true,
         priority_note = COALESCE(_priority_note, priority_note),
         due_date = COALESCE(_due_date, due_date),
         updated_at = v_now
   WHERE id = _list_id;

  -- ON COMMIT DROP only fires at commit, so a second call inside the same
  -- transaction would hit "relation already exists". One RPC per request hides
  -- this today; dropping first keeps the function re-entrant regardless.
  DROP TABLE IF EXISTS _eligible_members;
  DROP TABLE IF EXISTS _assignments;

  CREATE TEMP TABLE _eligible_members ON COMMIT DROP AS
  SELECT llm.lead_id,
         row_number() OVER (ORDER BY llm.added_at, llm.lead_id) AS lead_index
  FROM public.lead_list_members llm
  JOIN public.leads l ON l.id = llm.lead_id
  WHERE llm.list_id = _list_id
    AND (NOT _only_unassigned OR l.counsellor_id IS NULL);

  SELECT count(*) INTO v_total_leads FROM _eligible_members;

  INSERT INTO public.lead_list_assignment_batches (
    list_id, assigned_by_profile_id, assigned_by_user_id, counsellor_ids, total_leads
  )
  VALUES (
    _list_id,
    v_caller_profile_id,
    v_caller_user_id,
    (SELECT array_agg(id ORDER BY ord)
     FROM (
       SELECT DISTINCT ON (p.id) p.id, requested.ord
       FROM unnest(_counsellor_ids) WITH ORDINALITY AS requested(id, ord)
       JOIN public.profiles p ON p.id = requested.id
       WHERE requested.id IS NOT NULL
       ORDER BY p.id, requested.ord
     ) ordered),
    v_total_leads
  )
  RETURNING id INTO v_batch_id;

  PERFORM set_config('app.bulk_assign', 'on', true);

  CREATE TEMP TABLE _assignments ON COMMIT DROP AS
  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  counsellor_count AS (
    SELECT count(*)::integer AS n FROM selected_counsellors
  )
  SELECT om.lead_id, om.lead_index, sc.counsellor_id
  FROM _eligible_members om
  CROSS JOIN counsellor_count cc
  JOIN selected_counsellors sc
    ON sc.counsellor_index = ((om.lead_index - 1) % cc.n) + 1;

  WITH current_rows AS (
    SELECT l.id AS lead_id,
           l.counsellor_id AS previous_counsellor_id,
           l.stage AS lead_stage_at_assignment,
           a.counsellor_id
    FROM _assignments a
    JOIN public.leads l ON l.id = a.lead_id
  ),
  updated AS (
    UPDATE public.leads l
       SET counsellor_id = cr.counsellor_id,
           assigned_at = v_now
      FROM current_rows cr
     WHERE l.id = cr.lead_id
     RETURNING l.id
  ),
  history_insert AS (
    INSERT INTO public.lead_assignment_history (
      lead_id, assigned_to, previous_counsellor_id, assigned_by_profile_id,
      assigned_by_user_id, assignment_source, bucket_name,
      lead_stage_at_assignment, list_id, list_assignment_batch_id
    )
    SELECT cr.lead_id, cr.counsellor_id, cr.previous_counsellor_id, v_caller_profile_id,
           v_caller_user_id, 'list_round_robin', 'Lead List',
           cr.lead_stage_at_assignment, _list_id, v_batch_id
    FROM current_rows cr
    JOIN updated u ON u.id = cr.lead_id
    RETURNING assigned_to
  )
  SELECT count(*)::integer INTO v_assigned_count FROM history_insert;

  -- assigned_at is the cycle boundary: every call before it belongs to a
  -- previous cycle and is excluded from this list's outcomes.
  UPDATE public.lead_list_members m
     SET assigned_to = a.counsellor_id,
         work_status = 'pending',
         worked_at = NULL,
         call_log_id = NULL,
         assigned_at = v_now,
         sort_order = a.lead_index::integer
    FROM _assignments a
   WHERE m.list_id = _list_id AND m.lead_id = a.lead_id;

  -- Members that can never enter the dialer (no phone / terminal stage) leave
  -- the pending count now, so the list can actually reach done.
  PERFORM public.mark_call_list_undialable(_list_id);

  UPDATE public.lead_list_assignment_batches
     SET assigned_count = v_assigned_count,
         failed_count = GREATEST(v_total_leads - v_assigned_count, 0)
   WHERE id = v_batch_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT p.user_id,
         'lead_assigned',
         'Priority call list: ' || v_list_name,
         cnt.n || ' lead' || CASE WHEN cnt.n = 1 THEN '' ELSE 's' END || ' to call'
           || CASE WHEN _due_date IS NOT NULL THEN ' by ' || to_char(_due_date, 'DD Mon') ELSE '' END
           || COALESCE('. ' || _priority_note, ''),
         '/cloud-dialer?list=' || _list_id
  FROM (
    SELECT a.counsellor_id, count(*)::integer AS n
    FROM _assignments a GROUP BY a.counsellor_id
  ) cnt
  JOIN public.profiles p ON p.id = cnt.counsellor_id
  WHERE p.user_id IS NOT NULL;

  RETURN QUERY
  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           COALESCE(p.display_name, 'Unknown')::text AS counsellor_name,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  expected AS (
    SELECT a.counsellor_id, count(*)::integer AS n FROM _assignments a GROUP BY a.counsellor_id
  ),
  counts AS (
    SELECT h.assigned_to, count(*)::integer AS assigned_count
    FROM public.lead_assignment_history h
    WHERE h.list_assignment_batch_id = v_batch_id
    GROUP BY h.assigned_to
  )
  SELECT
    v_batch_id,
    sc.counsellor_id,
    sc.counsellor_name,
    COALESCE(c.assigned_count, 0)::integer,
    GREATEST(COALESCE(e.n, 0) - COALESCE(c.assigned_count, 0), 0)::integer
  FROM selected_counsellors sc
  LEFT JOIN counts c ON c.assigned_to = sc.counsellor_id
  LEFT JOIN expected e ON e.counsellor_id = sc.counsellor_id
  ORDER BY sc.counsellor_index;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date) TO authenticated;
