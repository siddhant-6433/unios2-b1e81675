-- Call lists: per-member work state so an assigned lead list becomes a workable
-- call queue instead of a one-off ownership rewrite.
--
-- Before this migration, assign_lead_list_round_robin only set leads.counsellor_id.
-- The Cloud Dialer queue has no list bucket and its "New Lead" bucket requires
-- stage='new_lead' AND first_contact_at IS NULL, so a list of already-touched
-- leads assigned to a counsellor was invisible in the dialer — the assignment
-- silently did nothing.
--
-- This adds:
--   1. lead_lists.purpose/priority_note/due_date/is_active  (calling vs marketing)
--   2. lead_list_members work state (assigned_to, work_status, worked_at, ...)
--   3. Real RLS on lead_lists / lead_list_members (was USING (true) for everyone)
--   4. assign_lead_list_round_robin writes member state + one batched notification
--   5. call_logs trigger marks a member "worked" from ANY calling surface

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS priority_note text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.lead_lists DROP CONSTRAINT IF EXISTS lead_lists_purpose_check;
ALTER TABLE public.lead_lists
  ADD CONSTRAINT lead_lists_purpose_check CHECK (purpose IN ('marketing', 'calling'));

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS worked_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer;

ALTER TABLE public.lead_list_members DROP CONSTRAINT IF EXISTS lead_list_members_work_status_check;
ALTER TABLE public.lead_list_members
  ADD CONSTRAINT lead_list_members_work_status_check
  CHECK (work_status IN ('pending', 'worked', 'skipped'));

-- Partial index: the dialer only ever reads pending members for one counsellor.
CREATE INDEX IF NOT EXISTS idx_llm_assigned_pending
  ON public.lead_list_members (assigned_to, list_id)
  WHERE work_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_llm_lead_pending
  ON public.lead_list_members (lead_id)
  WHERE work_status = 'pending';

COMMENT ON COLUMN public.lead_lists.purpose IS
  'marketing = campaign recipient list (default, legacy behaviour). calling = a call list assigned to counsellors and worked through the Cloud Dialer.';
COMMENT ON COLUMN public.lead_list_members.work_status IS
  'pending = still to be called, worked = a call_logs row landed for this lead, skipped = counsellor explicitly skipped it in the dialer.';

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Was: FOR ALL TO authenticated USING (true) WITH CHECK (true) — any staff user
-- could delete any list out from under a live campaign. Reads stay open (the
-- dialer, campaign UI and counsellors all need them); writes follow the same
-- role set the assignment RPC already enforces, and DELETE matches the existing
-- UI gate (super_admin only, src/pages/LeadLists.tsx).

CREATE OR REPLACE FUNCTION public.can_manage_lead_lists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'counsellor'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_lead_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_lead_lists() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can manage lead_lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Staff can view lead_lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Staff can write lead_lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Staff can update lead_lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Super admin can delete lead_lists" ON public.lead_lists;

CREATE POLICY "Staff can view lead_lists"
  ON public.lead_lists FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can write lead_lists"
  ON public.lead_lists FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_lead_lists());

CREATE POLICY "Staff can update lead_lists"
  ON public.lead_lists FOR UPDATE TO authenticated
  USING (public.can_manage_lead_lists())
  WITH CHECK (public.can_manage_lead_lists());

CREATE POLICY "Super admin can delete lead_lists"
  ON public.lead_lists FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP POLICY IF EXISTS "Authenticated users can manage lead_list_members" ON public.lead_list_members;
DROP POLICY IF EXISTS "Staff can view lead_list_members" ON public.lead_list_members;
DROP POLICY IF EXISTS "Staff can write lead_list_members" ON public.lead_list_members;
DROP POLICY IF EXISTS "Staff can update lead_list_members" ON public.lead_list_members;
DROP POLICY IF EXISTS "Staff can delete lead_list_members" ON public.lead_list_members;

CREATE POLICY "Staff can view lead_list_members"
  ON public.lead_list_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can write lead_list_members"
  ON public.lead_list_members FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_lead_lists());

-- Counsellors need UPDATE to mark their own members skipped from the dialer.
CREATE POLICY "Staff can update lead_list_members"
  ON public.lead_list_members FOR UPDATE TO authenticated
  USING (
    public.can_manage_lead_lists()
    OR assigned_to IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
  )
  WITH CHECK (
    public.can_manage_lead_lists()
    OR assigned_to IN (SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY "Staff can delete lead_list_members"
  ON public.lead_list_members FOR DELETE TO authenticated
  USING (public.can_manage_lead_lists());

-- ── 3. Batched assignment notifications ──────────────────────────────────────
-- fn_notify_lead_assigned fires one notifications row (and one push, via
-- trg_push_on_notification) per lead. A 500-lead list assignment produced 500
-- pushes. The assignment RPC now sets a transaction-local GUC so the per-lead
-- trigger stays quiet and the RPC emits one summary notification per counsellor.

CREATE OR REPLACE FUNCTION public.fn_notify_lead_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counsellor_user_id uuid;
BEGIN
  -- Bulk list assignment sends one summary notification instead of one per lead.
  IF current_setting('app.bulk_assign', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF (OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id) AND NEW.counsellor_id IS NOT NULL THEN
    SELECT p.user_id INTO v_counsellor_user_id
    FROM public.profiles p
    WHERE p.id = NEW.counsellor_id
    LIMIT 1;

    IF v_counsellor_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        v_counsellor_user_id,
        'lead_assigned',
        'New lead assigned: ' || NEW.name,
        'Make first contact within the SLA window.',
        '/admissions/' || NEW.id,
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. assign_lead_list_round_robin: member state + only-unassigned + summary ─

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

  -- Mark the list as a call list and stamp the working instructions.
  UPDATE public.lead_lists
     SET purpose = 'calling',
         is_active = true,
         priority_note = COALESCE(_priority_note, priority_note),
         due_date = COALESCE(_due_date, due_date),
         updated_at = now()
   WHERE id = _list_id;

  -- Eligible members: everything in the list, or only the currently-unassigned
  -- ones when the assigner asked not to steal owned leads.
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

  -- Suppress the per-lead assignment notification for this transaction; one
  -- summary notification per counsellor is emitted below.
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
           assigned_at = now()
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

  -- Member work state: this is what makes the list dialable.
  UPDATE public.lead_list_members m
     SET assigned_to = a.counsellor_id,
         work_status = 'pending',
         worked_at = NULL,
         call_log_id = NULL,
         sort_order = a.lead_index::integer
    FROM _assignments a
   WHERE m.list_id = _list_id AND m.lead_id = a.lead_id;

  UPDATE public.lead_list_assignment_batches
     SET assigned_count = v_assigned_count,
         failed_count = GREATEST(v_total_leads - v_assigned_count, 0)
   WHERE id = v_batch_id;

  -- One summary notification per counsellor, deep-linked into the dialer list.
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
    -- Real failure count: expected minus actually-written (RLS/FK drops).
    GREATEST(COALESCE(e.n, 0) - COALESCE(c.assigned_count, 0), 0)::integer
  FROM selected_counsellors sc
  LEFT JOIN counts c ON c.assigned_to = sc.counsellor_id
  LEFT JOIN expected e ON e.counsellor_id = sc.counsellor_id
  ORDER BY sc.counsellor_index;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date) TO authenticated;

-- Retire the 2-arg overload so callers can't accidentally bypass member state.
DROP FUNCTION IF EXISTS public.assign_lead_list_round_robin(uuid, uuid[]);

-- ── 5. Mark members worked on any call ───────────────────────────────────────
-- Extends the existing AFTER INSERT ON call_logs trigger function (which already
-- clears dialer pins) rather than adding a second trigger. Works no matter which
-- surface placed the call — list mode, smart queue, or the lead page.

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
       AND m.work_status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;
