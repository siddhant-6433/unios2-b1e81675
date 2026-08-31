-- Hardening for the call-list rollover shipped in 20260831084549.
--
-- Adversarial review of that migration found three defects that were live in
-- production. All three are fixed here.
--
-- 1. SECURITY HOLE. call_list_followup_candidates and call_list_followup_counts
--    were SECURITY DEFINER, GRANTed to `authenticated`, and carried no
--    permission check — every other function in that migration gates on
--    can_manage_lead_list, these two did not. Any logged-in principal
--    (counsellor, teacher, academic/admission partner, portal user) holding a
--    list UUID could read lead_id, assigned_to, stage and work_status for every
--    member, bypassing can_view_lead entirely. Same shape as the cloud-dialer
--    queue RLS divergence.
--
-- 2. DESTRUCTIVE STAGE WRITE. build_followup_list sets stage='cold' on exhausted
--    leads. That fires trg_cancel_followups_terminal_stage, whose function
--    cancels EVERY pending lead_followups row for the lead except
--    type='cold_followup' — including callbacks a counsellor set by hand. One
--    Roll-forward click could silently destroy hundreds of them.
--    The cold write itself is intended (it feeds fn_cold_lead_cycle), so it
--    stays — but a lead holding a pending human follow-up is now left alone.
--
-- 3. ORPHANED MEMBERS. Members with no owner (assigned_to and counsellor_id both
--    NULL) were carried into the new list and counted, but skipped by the
--    lead_assignment_history insert (assigned_to is NOT NULL there) and by the
--    notification. They landed in nobody's dialer queue and in no Calling
--    Report, then re-accrued attempt_count every cycle until silently cooled.
--
-- Also: a concurrency guard (double-click / retry produced duplicate generations),
-- and exhausted members are parked not_dialable so restoring that list from the
-- Archived tab cannot push phone-less or terminal leads back into a dialer.

-- ── 1. Permission-check the two read RPCs ────────────────────────────────────
-- Both become plpgsql so they can RAISE. Signatures and return shapes are
-- unchanged, so callers need no edit.

CREATE OR REPLACE FUNCTION public.call_list_followup_candidates(_list_id uuid)
RETURNS TABLE (
  lead_id       uuid,
  assigned_to   uuid,
  attempt_count integer,
  lead_stage    public.lead_stage,
  work_status   text,
  bucket        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.can_manage_lead_list(_list_id) THEN
    RAISE EXCEPTION 'Insufficient permissions to read this list';
  END IF;

  RETURN QUERY
  SELECT
    m.lead_id,
    COALESCE(m.assigned_to, l.counsellor_id) AS assigned_to,
    m.attempt_count,
    l.stage AS lead_stage,
    m.work_status,
    CASE
      WHEN m.work_status = 'pending' THEN 'pending'
      WHEN latest.disposition IN ('not_answered', 'busy', 'voicemail') THEN 'no_answer'
      WHEN m.work_status = 'worked' AND latest.disposition IS NULL THEN 'unrecorded'
      ELSE NULL
    END AS bucket
  FROM public.lead_list_members m
  JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.profiles assignee ON assignee.id = m.assigned_to
  LEFT JOIN LATERAL (
    SELECT x.disposition
    FROM (
      SELECT cl.disposition, cl.called_at
      FROM public.call_logs cl
      WHERE cl.lead_id = m.lead_id
        AND (m.assigned_at IS NULL OR cl.called_at >= m.assigned_at)
        AND (assignee.user_id IS NULL OR cl.user_id = assignee.user_id)
      UNION ALL
      SELECT acl.disposition, acl.created_at AS called_at
      FROM public.ai_call_logs acl
      WHERE acl.lead_id = m.lead_id
        AND (m.assigned_at IS NULL OR acl.created_at >= m.assigned_at)
    ) x
    WHERE x.disposition IS NOT NULL
    ORDER BY x.called_at DESC NULLS LAST
    LIMIT 1
  ) latest ON true
  WHERE m.list_id = _list_id
    AND m.lead_id IS NOT NULL
    AND m.work_status <> 'not_dialable'
    AND l.phone IS NOT NULL;
END $fn$;

REVOKE ALL ON FUNCTION public.call_list_followup_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_followup_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.call_list_followup_counts(_list_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_manage_lead_list(_list_id) THEN
    RAISE EXCEPTION 'Insufficient permissions to read this list';
  END IF;

  WITH cand AS (
    SELECT * FROM public.call_list_followup_candidates(_list_id)
  ),
  cap AS (
    SELECT COALESCE(max_attempts, 4) AS max_attempts FROM public.lead_lists WHERE id = _list_id
  ),
  progress AS (
    SELECT
      count(*) FILTER (WHERE work_status IS DISTINCT FROM 'not_dialable')::int AS dialable,
      count(*) FILTER (WHERE work_status = 'worked')::int                      AS attempted
    FROM public.lead_list_members WHERE list_id = _list_id
  )
  SELECT jsonb_build_object(
    'pending',    (SELECT count(*)::int FROM cand WHERE bucket = 'pending'),
    'no_answer',  (SELECT count(*)::int FROM cand WHERE bucket = 'no_answer'),
    'unrecorded', (SELECT count(*)::int FROM cand WHERE bucket = 'unrecorded'),
    'at_cap',     (SELECT count(*)::int FROM cand, cap
                    WHERE cand.bucket IS NOT NULL
                      AND cand.attempt_count + 1 >= cap.max_attempts),
    'max_attempts', (SELECT max_attempts FROM cap),
    'dialable',   (SELECT dialable FROM progress),
    -- Numerator and denominator both come from `cand` now. Mixing cand with
    -- lead_list_members made contact_rate read low on any list holding
    -- phone-less members, because cand excludes them and progress did not.
    'attempted',  (SELECT count(*)::int FROM cand WHERE work_status = 'worked'),
    'connected',  (SELECT count(*)::int FROM cand WHERE work_status = 'worked' AND bucket IS NULL),
    'contact_rate', (
      SELECT CASE WHEN count(*) FILTER (WHERE work_status = 'worked') > 0
        THEN round(100.0 * count(*) FILTER (WHERE work_status = 'worked' AND bucket IS NULL)
                   / count(*) FILTER (WHERE work_status = 'worked'), 1)
        ELSE NULL END
      FROM cand)
  ) INTO v_result;

  RETURN v_result;
END $fn$;

REVOKE ALL ON FUNCTION public.call_list_followup_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_followup_counts(uuid) TO authenticated;

-- ── 2. build_followup_list: concurrency guard, no orphans, safe cooling ──────

CREATE OR REPLACE FUNCTION public.build_followup_list(
  _source_list_id uuid,
  _buckets        text[],
  _due_date       date    DEFAULT NULL,
  _list_name      text    DEFAULT NULL,
  _archive_source boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id       uuid := auth.uid();
  v_profile_id    uuid;
  v_now           timestamptz := now();
  v_src           public.lead_lists%ROWTYPE;
  v_new_list_id   uuid;
  v_new_name      text;
  v_exhausted_id  uuid;
  v_batch_id      uuid;
  v_carried       integer := 0;
  v_exhausted     integer := 0;
  v_cooled        integer := 0;
  v_unowned       integer := 0;
  v_cold_skipped  integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_manage_lead_list(_source_list_id) THEN
    RAISE EXCEPTION 'Insufficient permissions to roll this list forward';
  END IF;
  IF COALESCE(array_length(_buckets, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Pick at least one follow-up bucket';
  END IF;

  -- FOR UPDATE serialises concurrent rollovers of the same list. Without it a
  -- double-click (or a retry after a statement timeout) produced two
  -- generation N+1 lists with duplicate members, doubled notifications and
  -- double-incremented attempt_count, pushing leads to the cap a cycle early.
  SELECT * INTO v_src FROM public.lead_lists WHERE id = _source_list_id FOR UPDATE;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Source list not found';
  END IF;
  IF v_src.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This list has already been rolled forward or archived';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;

  DROP TABLE IF EXISTS pg_temp._cand;
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT c.lead_id, c.assigned_to, c.attempt_count, c.lead_stage,
         (c.attempt_count + 1 >= COALESCE(v_src.max_attempts, 4)) AS is_exhausted
  FROM public.call_list_followup_candidates(_source_list_id) c
  WHERE c.bucket = ANY(_buckets)
    -- An unowned member cannot get a lead_assignment_history row (assigned_to is
    -- NOT NULL there) and so would land in no Calling Report and no dialer
    -- queue, while still burning an attempt every cycle. Count and exclude.
    AND c.assigned_to IS NOT NULL;

  SELECT count(*) INTO v_unowned
  FROM public.call_list_followup_candidates(_source_list_id) c
  WHERE c.bucket = ANY(_buckets) AND c.assigned_to IS NULL;

  SELECT count(*) FILTER (WHERE NOT is_exhausted),
         count(*) FILTER (WHERE is_exhausted)
    INTO v_carried, v_exhausted
  FROM _cand;

  IF v_carried = 0 AND v_exhausted = 0 THEN
    RETURN jsonb_build_object('carried', 0, 'exhausted', 0, 'list_id', NULL,
                              'unowned_skipped', v_unowned,
                              'message', 'No leads matched those buckets');
  END IF;

  IF v_carried > 0 THEN
    v_new_name := COALESCE(NULLIF(btrim(_list_name), ''),
                           v_src.name || ' - attempt ' || (COALESCE(v_src.generation, 1) + 1));

    INSERT INTO public.lead_lists (
      name, description, source, purpose, is_active, include_terminal,
      due_date, created_by, parent_list_id, generation, max_attempts
    ) VALUES (
      v_new_name,
      'Follow-up from "' || v_src.name || '" - ' || v_carried || ' leads',
      'filter', 'calling', true, true,
      _due_date, v_profile_id, _source_list_id,
      COALESCE(v_src.generation, 1) + 1, COALESCE(v_src.max_attempts, 4)
    )
    RETURNING id INTO v_new_list_id;

    INSERT INTO public.lead_list_members (
      list_id, lead_id, assigned_to, work_status, assigned_at, attempt_count, sort_order
    )
    SELECT v_new_list_id, c.lead_id, c.assigned_to, 'pending', v_now, c.attempt_count + 1,
           row_number() OVER (ORDER BY c.assigned_to, c.lead_id)::integer
    FROM _cand c
    WHERE NOT c.is_exhausted;

    INSERT INTO public.lead_list_assignment_batches (
      list_id, assigned_by_profile_id, assigned_by_user_id, counsellor_ids,
      total_leads, assigned_count
    )
    SELECT v_new_list_id, v_profile_id, v_user_id,
           COALESCE(array_agg(DISTINCT c.assigned_to), '{}'),
           v_carried, v_carried
    FROM _cand c WHERE NOT c.is_exhausted
    RETURNING id INTO v_batch_id;

    INSERT INTO public.lead_assignment_history (
      lead_id, assigned_to, previous_counsellor_id, assigned_by_profile_id,
      assigned_by_user_id, assignment_source, bucket_name,
      lead_stage_at_assignment, list_id, list_assignment_batch_id
    )
    SELECT c.lead_id, c.assigned_to, c.assigned_to, v_profile_id, v_user_id,
           'list_followup', 'Follow-up', c.lead_stage, v_new_list_id, v_batch_id
    FROM _cand c
    WHERE NOT c.is_exhausted;

    PERFORM public.mark_call_list_undialable(v_new_list_id);

    UPDATE public.lead_lists ll
       SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = ll.id)
     WHERE ll.id = v_new_list_id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT p.user_id,
           'lead_assigned',
           'Follow-up call list: ' || v_new_name,
           cnt.n || ' lead' || CASE WHEN cnt.n = 1 THEN '' ELSE 's' END || ' to call again'
             || CASE WHEN _due_date IS NOT NULL THEN ' by ' || to_char(_due_date, 'DD Mon') ELSE '' END
             || '. Open Cloud Dialer to start.',
           '/cloud-dialer?list=' || v_new_list_id
    FROM (
      SELECT c.assigned_to AS counsellor_id, count(*)::integer AS n
      FROM _cand c WHERE NOT c.is_exhausted
      GROUP BY c.assigned_to
    ) cnt
    JOIN public.profiles p ON p.id = cnt.counsellor_id
    WHERE p.user_id IS NOT NULL;
  END IF;

  IF v_exhausted > 0 THEN
    INSERT INTO public.lead_lists (
      name, description, source, purpose, archived_at, created_by,
      parent_list_id, generation, max_attempts
    ) VALUES (
      v_src.name || ' - exhausted',
      v_exhausted || ' leads reached the ' || COALESCE(v_src.max_attempts, 4) || '-attempt cap without connecting',
      'filter', 'marketing', v_now, v_profile_id, _source_list_id,
      COALESCE(v_src.generation, 1) + 1, COALESCE(v_src.max_attempts, 4)
    )
    RETURNING id INTO v_exhausted_id;

    -- not_dialable, not pending: this list is archived, but set_lead_list_archived
    -- is offered on every row, so restoring it must not push phone-less or
    -- terminal leads back into a dialer queue.
    INSERT INTO public.lead_list_members (
      list_id, lead_id, assigned_to, work_status, attempt_count
    )
    SELECT v_exhausted_id, c.lead_id, c.assigned_to, 'not_dialable', c.attempt_count + 1
    FROM _cand c WHERE c.is_exhausted;

    UPDATE public.lead_lists ll
       SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = ll.id)
     WHERE ll.id = v_exhausted_id;

    -- Cooling stays (it is what feeds fn_cold_lead_cycle), but stage='cold'
    -- fires trg_cancel_followups_terminal_stage, which cancels every pending
    -- lead_followups row for the lead except type='cold_followup'. A lead
    -- holding a human-set callback is therefore left at its current stage
    -- rather than having that callback silently destroyed.
    WITH cooled AS (
      UPDATE public.leads l
         SET stage = 'cold'::public.lead_stage
        FROM _cand c
       WHERE l.id = c.lead_id
         AND c.is_exhausted
         AND l.stage IN ('new_lead', 'ai_called', 'counsellor_call')
         AND NOT EXISTS (
           SELECT 1 FROM public.lead_followups f
           WHERE f.lead_id = l.id
             AND f.status = 'pending'
             AND f.type <> 'cold_followup'
         )
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_cooled FROM cooled;

    SELECT count(*)::integer INTO v_cold_skipped
    FROM _cand c
    JOIN public.leads l ON l.id = c.lead_id
    WHERE c.is_exhausted
      AND l.stage IN ('new_lead', 'ai_called', 'counsellor_call')
      AND EXISTS (
        SELECT 1 FROM public.lead_followups f
        WHERE f.lead_id = l.id AND f.status = 'pending' AND f.type <> 'cold_followup'
      );
  END IF;

  IF _archive_source THEN
    UPDATE public.lead_lists
       SET archived_at = COALESCE(archived_at, v_now), updated_at = v_now
     WHERE id = _source_list_id;
  END IF;

  RETURN jsonb_build_object(
    'list_id',           v_new_list_id,
    'list_name',         v_new_name,
    'carried',           v_carried,
    'exhausted',         v_exhausted,
    'cooled',            v_cooled,
    'cold_skipped',      v_cold_skipped,
    'unowned_skipped',   v_unowned,
    'exhausted_list_id', v_exhausted_id,
    'generation',        COALESCE(v_src.generation, 1) + 1,
    'source_archived',   _archive_source
  );
END $fn$;

REVOKE ALL ON FUNCTION public.build_followup_list(uuid, text[], date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_followup_list(uuid, text[], date, text, boolean) TO authenticated;
