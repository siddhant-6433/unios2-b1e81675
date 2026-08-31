-- Call-list rollover: archive + follow-up chains + throughput
--
-- lead_lists.is_active has existed since 20260802082638 and is honoured by
-- my_call_lists, call_list_overview, assignable_counsellors, fn_cleanup_cloud_dialer_pin
-- and the dynamic-refresh cron — but NOTHING has ever set it to false. The only way a
-- list left the page was a hard DELETE, which cascades away every member row and all
-- of its call history. Yesterday's lists therefore pile up forever and the leads that
-- were never reached sit in a stale list nobody works.
--
-- This adds:
--   1. archived_at (+ a trigger that keeps is_active in sync, so the six RPCs above
--      keep working untouched), plus parent_list_id / generation / max_attempts so a
--      chain of retry attempts is walkable, and lead_list_members.attempt_count.
--   2. set_lead_list_archived      — archive/restore with a real permission check.
--   3. call_list_followup_candidates — ONE definition of the three follow-up buckets.
--   4. call_list_followup_counts   — preview counts + throughput, same predicates.
--   5. build_followup_list         — spawn the next attempt, server-side.
--
-- Selection lives in SQL on purpose. The old client-side createFollowupList derived
-- its lead ids from a report loaded with `_limit: 500` and no paging, so building a
-- follow-up from any list over 500 leads silently dropped everyone past row 500.

-- ── 1. Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS parent_list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts   integer NOT NULL DEFAULT 4;

COMMENT ON COLUMN public.lead_lists.archived_at IS
  'Single source of truth for "archived". is_active is kept in sync by trg_lead_lists_sync_is_active so pre-existing RPCs that filter is_active need no change.';
COMMENT ON COLUMN public.lead_lists.generation IS
  'Attempt number in a follow-up chain. 1 = original list; a rollover spawns generation + 1.';
COMMENT ON COLUMN public.lead_lists.max_attempts IS
  'Retry cap for the chain. At attempt_count + 1 >= max_attempts a lead exits into the "- exhausted" list instead of being carried forward.';

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.lead_list_members.attempt_count IS
  'How many calling cycles this lead has already been through in this chain. Incremented on each rollover; read against lead_lists.max_attempts.';

CREATE INDEX IF NOT EXISTS idx_lead_lists_parent
  ON public.lead_lists (parent_list_id) WHERE parent_list_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_lists_active
  ON public.lead_lists (archived_at) WHERE archived_at IS NULL;

-- Two flags that must agree are drift bait, so is_active is derived, never written
-- by hand. Existing rows all have archived_at NULL, which maps to is_active = true.
CREATE OR REPLACE FUNCTION public.lead_lists_sync_is_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_active := (NEW.archived_at IS NULL);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_lists_sync_is_active ON public.lead_lists;
CREATE TRIGGER trg_lead_lists_sync_is_active
  BEFORE INSERT OR UPDATE OF archived_at ON public.lead_lists
  FOR EACH ROW EXECUTE FUNCTION public.lead_lists_sync_is_active();

-- A rollover writes assignment history so the new list has a Calling Report at all
-- (get_lead_list_assignment_report reads lead_assignment_history, not the members).
ALTER TABLE public.lead_assignment_history
  DROP CONSTRAINT IF EXISTS lead_assignment_history_assignment_source_check;
ALTER TABLE public.lead_assignment_history
  ADD CONSTRAINT lead_assignment_history_assignment_source_check
  CHECK (assignment_source IN ('self_picked', 'assigned', 'ai_priority', 'list_round_robin', 'list_followup'));

-- ── 2. Permission helper ─────────────────────────────────────────────────────
-- RLS already lets any of the six can_manage_lead_lists() roles UPDATE lead_lists,
-- which would let a counsellor archive someone else's list. Mutating RPCs below
-- re-check: admin, or the list's creator, or team-leader of one of its assignees.

CREATE OR REPLACE FUNCTION public.can_manage_lead_list(_list_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(v_user_id, 'super_admin'::public.app_role)
     OR public.has_role(v_user_id, 'admission_head'::public.app_role)
     OR public.has_role(v_user_id, 'principal'::public.app_role) THEN
    RETURN true;
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;
  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.lead_lists ll WHERE ll.id = _list_id AND ll.created_by = v_profile_id) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.lead_list_members m
    JOIN public.teams t ON t.leader_id = v_profile_id
    JOIN public.team_members tm ON tm.team_id = t.id
    JOIN public.profiles member ON member.user_id = tm.user_id
    WHERE m.list_id = _list_id AND m.assigned_to = member.id
  );
END $$;

REVOKE ALL ON FUNCTION public.can_manage_lead_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_lead_list(uuid) TO authenticated;

-- ── 3. set_lead_list_archived ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_lead_list_archived(_list_id uuid, _archived boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_lead_list(_list_id) THEN
    RAISE EXCEPTION 'Insufficient permissions to archive this list';
  END IF;

  UPDATE public.lead_lists
     SET archived_at = CASE WHEN _archived THEN COALESCE(archived_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = _list_id;
END $$;

REVOKE ALL ON FUNCTION public.set_lead_list_archived(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_list_archived(uuid, boolean) TO authenticated;

-- ── 4. call_list_followup_candidates ─────────────────────────────────────────
-- The single definition of the three buckets. Both the preview counts and the
-- rollover itself read this, so what the dialog promises and what the button does
-- can never disagree.
--
--   pending    — never dialled                       (work_status = 'pending')
--   no_answer  — dialled, nobody picked up           (not_answered / busy / voicemail)
--   unrecorded — a call happened, no outcome logged  (worked, latest disposition NULL)
--
-- Anything with a real disposition (interested, call_back, not_interested, dnc,
-- wrong_number, ineligible, cold, course_not_listed, do_not_contact) is an OUTCOME
-- and is never carried forward — the chain did its job. interested / call_back
-- already get a lead_followups row from record_disposition_writes.

CREATE OR REPLACE FUNCTION public.call_list_followup_candidates(_list_id uuid)
RETURNS TABLE (
  lead_id       uuid,
  assigned_to   uuid,
  attempt_count integer,
  lead_stage    public.lead_stage,
  work_status   text,
  bucket        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Contacts (marketing_contacts) have no call history and are not dialable, so a
  -- follow-up chain only ever carries real leads.
  WHERE m.list_id = _list_id
    AND m.lead_id IS NOT NULL
    AND m.work_status <> 'not_dialable'
    AND l.phone IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.call_list_followup_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_followup_candidates(uuid) TO authenticated;

-- ── 5. call_list_followup_counts ─────────────────────────────────────────────
-- Drives the dialog's per-bucket checkbox counts, the "N will be dropped at the
-- attempt cap" warning, and the throughput strip in the report header.

CREATE OR REPLACE FUNCTION public.call_list_followup_counts(_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cand AS (
    SELECT * FROM public.call_list_followup_candidates(_list_id)
  ),
  cap AS (
    SELECT COALESCE(max_attempts, 4) AS max_attempts FROM public.lead_lists WHERE id = _list_id
  ),
  progress AS (
    SELECT
      count(*) FILTER (WHERE work_status <> 'not_dialable')::int AS dialable,
      count(*) FILTER (WHERE work_status = 'worked')::int        AS attempted
    FROM public.lead_list_members WHERE list_id = _list_id
  )
  SELECT jsonb_build_object(
    'pending',    (SELECT count(*)::int FROM cand WHERE bucket = 'pending'),
    'no_answer',  (SELECT count(*)::int FROM cand WHERE bucket = 'no_answer'),
    'unrecorded', (SELECT count(*)::int FROM cand WHERE bucket = 'unrecorded'),
    -- How many of those would be dropped rather than carried, at the current cap.
    'at_cap',     (SELECT count(*)::int FROM cand, cap
                    WHERE cand.bucket IS NOT NULL
                      AND cand.attempt_count + 1 >= cap.max_attempts),
    'max_attempts', (SELECT max_attempts FROM cap),
    -- Throughput for the report header. "connected" = dialled AND a real outcome was
    -- logged, i.e. worked with no follow-up bucket assigned to it.
    'dialable',   (SELECT dialable FROM progress),
    'attempted',  (SELECT attempted FROM progress),
    'connected',  (SELECT count(*)::int FROM cand
                    WHERE work_status = 'worked' AND bucket IS NULL),
    'contact_rate', (SELECT CASE WHEN attempted > 0
                       THEN round(100.0 * (SELECT count(*) FROM cand
                                            WHERE work_status = 'worked' AND bucket IS NULL)
                                  / attempted, 1)
                       ELSE NULL END
                     FROM progress)
  );
$$;

REVOKE ALL ON FUNCTION public.call_list_followup_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_followup_counts(uuid) TO authenticated;

-- ── 6. build_followup_list ───────────────────────────────────────────────────
-- Spawns the next attempt in the chain, entirely server-side.
--
-- Deliberately does NOT call assign_lead_list_round_robin: that function round-robins
-- and overwrites leads.counsellor_id, which would break the same-counsellor rule.
-- Ownership is carried from the source member row, and leads.counsellor_id is already
-- correct from the previous assignment, so no lead reassignment happens at all.
--
-- Do not CREATE OR REPLACE assign_lead_list_round_robin anywhere near this migration:
-- its body lives only in 20260802115927 and two later migrations patch its prosrc in
-- place (20260802131652, 20260804141436). Replacing it would clobber both patches.

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
AS $$
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

  SELECT * INTO v_src FROM public.lead_lists WHERE id = _source_list_id;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Source list not found';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;

  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT c.lead_id, c.assigned_to, c.attempt_count, c.lead_stage,
         (c.attempt_count + 1 >= COALESCE(v_src.max_attempts, 4)) AS is_exhausted
  FROM public.call_list_followup_candidates(_source_list_id) c
  WHERE c.bucket = ANY(_buckets);

  SELECT count(*) FILTER (WHERE NOT is_exhausted),
         count(*) FILTER (WHERE is_exhausted)
    INTO v_carried, v_exhausted
  FROM _cand;

  IF v_carried = 0 AND v_exhausted = 0 THEN
    RETURN jsonb_build_object('carried', 0, 'exhausted', 0, 'list_id', NULL,
                              'message', 'No leads matched those buckets');
  END IF;

  -- ── Carried leads → the next attempt in the chain ──
  IF v_carried > 0 THEN
    v_new_name := COALESCE(NULLIF(btrim(_list_name), ''),
                           v_src.name || ' - attempt ' || (COALESCE(v_src.generation, 1) + 1));

    INSERT INTO public.lead_lists (
      name, description, source, purpose, is_active, include_terminal,
      due_date, created_by, parent_list_id, generation, max_attempts
    ) VALUES (
      v_new_name,
      'Follow-up from "' || v_src.name || '" — ' || v_carried || ' leads',
      'filter', 'calling', true,
      -- Follow-ups re-engage leads whose stage went terminal but who were never
      -- actually reached, so terminal stages must stay dialable here.
      true,
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
           COALESCE(array_agg(DISTINCT c.assigned_to) FILTER (WHERE c.assigned_to IS NOT NULL), '{}'),
           v_carried, v_carried
    FROM _cand c WHERE NOT c.is_exhausted
    RETURNING id INTO v_batch_id;

    -- The Calling Report reads lead_assignment_history, not the member rows — without
    -- these the follow-up list would have an empty report and could not itself be
    -- rolled forward. assigned_to is NOT NULL there, so unowned members are skipped.
    INSERT INTO public.lead_assignment_history (
      lead_id, assigned_to, previous_counsellor_id, assigned_by_profile_id,
      assigned_by_user_id, assignment_source, bucket_name,
      lead_stage_at_assignment, list_id, list_assignment_batch_id
    )
    SELECT c.lead_id, c.assigned_to, c.assigned_to, v_profile_id, v_user_id,
           'list_followup', 'Follow-up', c.lead_stage, v_new_list_id, v_batch_id
    FROM _cand c
    WHERE NOT c.is_exhausted AND c.assigned_to IS NOT NULL;

    PERFORM public.mark_call_list_undialable(v_new_list_id);

    UPDATE public.lead_lists ll
       SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = ll.id)
     WHERE ll.id = v_new_list_id;

    -- One notification per counsellor, not per lead.
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
      FROM _cand c WHERE NOT c.is_exhausted AND c.assigned_to IS NOT NULL
      GROUP BY c.assigned_to
    ) cnt
    JOIN public.profiles p ON p.id = cnt.counsellor_id
    WHERE p.user_id IS NOT NULL;
  END IF;

  -- ── Exhausted leads → parked list + cooled ──
  IF v_exhausted > 0 THEN
    -- Parked as an already-archived MARKETING list: it must never enter a dialer
    -- queue, but it stays available for a WhatsApp re-target.
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

    INSERT INTO public.lead_list_members (
      list_id, lead_id, assigned_to, work_status, attempt_count
    )
    SELECT v_exhausted_id, c.lead_id, c.assigned_to, 'pending', c.attempt_count + 1
    FROM _cand c WHERE c.is_exhausted;

    UPDATE public.lead_lists ll
       SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = ll.id)
     WHERE ll.id = v_exhausted_id;

    -- Cool them off, but ONLY from the three stages that mean "never engaged".
    -- application_in_progress and everything after it means the lead actually did
    -- something, and terminal stages are already terminal. A broader stage write
    -- here would collide with recompute_lead_fee_stage and the stage-audit job.
    WITH cooled AS (
      UPDATE public.leads l
         SET stage = 'cold'::public.lead_stage
        FROM _cand c
       WHERE l.id = c.lead_id
         AND c.is_exhausted
         AND l.stage IN ('new_lead', 'ai_called', 'counsellor_call')
      RETURNING 1
    )
    SELECT count(*)::integer INTO v_cooled FROM cooled;
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
    'exhausted_list_id', v_exhausted_id,
    'generation',        COALESCE(v_src.generation, 1) + 1,
    'source_archived',   _archive_source
  );
END $$;

REVOKE ALL ON FUNCTION public.build_followup_list(uuid, text[], date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_followup_list(uuid, text[], date, text, boolean) TO authenticated;
