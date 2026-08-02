-- Dynamic lead lists: membership re-derived from a saved filter, not frozen.
--
-- Today every list is a static set of lead_ids, so "BBA + Meta" stops being true
-- the moment the next Meta lead arrives and the assigner has to rebuild and
-- re-assign it by hand.
--
-- filters_snapshot is deliberately NOT reused: it is audit metadata with five
-- mutually incompatible shapes (Admissions, LeadBuckets, CahetSprint,
-- UpdeledSprint, Applications) that nothing reads, and half the filters it can
-- carry resolve to lead-id Sets computed by other queries on the page, which
-- cannot be re-derived on a cron. filter_definition is a new canonical
-- vocabulary that maps 1:1 to columns on public.leads.
-- Its TypeScript twin is src/lib/dynamicListFilters.ts — keep them in lockstep.

ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS filter_definition jsonb,
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS include_terminal boolean NOT NULL DEFAULT false;

ALTER TABLE public.lead_lists DROP CONSTRAINT IF EXISTS lead_lists_list_type_check;
ALTER TABLE public.lead_lists
  ADD CONSTRAINT lead_lists_list_type_check CHECK (list_type IN ('static', 'dynamic'));

-- A dynamic list with no filter would quietly match every lead in the database.
ALTER TABLE public.lead_lists DROP CONSTRAINT IF EXISTS lead_lists_dynamic_needs_filter;
ALTER TABLE public.lead_lists
  ADD CONSTRAINT lead_lists_dynamic_needs_filter
  CHECK (list_type = 'static' OR filter_definition IS NOT NULL);

COMMENT ON COLUMN public.lead_lists.list_type IS
  'static = frozen set of lead_ids. dynamic = membership re-derived from filter_definition on a cron.';
COMMENT ON COLUMN public.lead_lists.filter_definition IS
  'Canonical dynamic-list filter. Keys: course_ids[], sources[], campus_ids[], stages[], lead_temperature, lead_institution_type, created_from, created_to. All optional, AND-ed. See src/lib/dynamicListFilters.ts.';
COMMENT ON COLUMN public.lead_lists.include_terminal IS
  'When true, cold/not-interested/closed leads stay dialable for this list (win-back pushes). When false they are marked not_dialable at hand-off.';

CREATE INDEX IF NOT EXISTS idx_lead_lists_dynamic_active
  ON public.lead_lists (list_type, is_active) WHERE list_type = 'dynamic';

-- ── Membership predicate ────────────────────────────────────────────────────
-- One place decides "does this lead match this filter". source and stage are
-- enums, so the jsonb text has to be cast explicitly.

CREATE OR REPLACE FUNCTION public.lead_matches_filter(_lead public.leads, _f jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(_lead.is_mirror, false) = false
    AND (_f->'course_ids' IS NULL OR _lead.course_id::text IN (
          SELECT jsonb_array_elements_text(_f->'course_ids')))
    AND (_f->'sources' IS NULL OR _lead.source::text IN (
          SELECT jsonb_array_elements_text(_f->'sources')))
    AND (_f->'campus_ids' IS NULL OR _lead.campus_id::text IN (
          SELECT jsonb_array_elements_text(_f->'campus_ids')))
    AND (_f->'stages' IS NULL OR _lead.stage::text IN (
          SELECT jsonb_array_elements_text(_f->'stages')))
    AND (_f->>'lead_temperature' IS NULL OR _lead.lead_temperature = _f->>'lead_temperature')
    AND (_f->>'lead_institution_type' IS NULL OR _lead.lead_institution_type = _f->>'lead_institution_type')
    AND (_f->>'created_from' IS NULL OR _lead.created_at >= (_f->>'created_from')::date)
    AND (_f->>'created_to' IS NULL OR _lead.created_at < ((_f->>'created_to')::date + 1));
$$;

COMMENT ON FUNCTION public.lead_matches_filter(public.leads, jsonb) IS
  'Single source of truth for dynamic-list membership. Mirrors src/lib/dynamicListFilters.ts.';

-- ── Resolver ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_dynamic_list_members(_list_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list public.lead_lists;
  v_now timestamptz := now();
  v_added int := 0;
  v_removed int := 0;
  v_next_order int;
  v_owners uuid[];
BEGIN
  SELECT * INTO v_list FROM public.lead_lists WHERE id = _list_id;
  IF v_list.id IS NULL OR v_list.list_type <> 'dynamic' OR v_list.filter_definition IS NULL THEN
    RETURN jsonb_build_object('added', 0, 'removed', 0, 'skipped', true);
  END IF;

  -- Counsellors already holding members of this list. New matches are split
  -- across them so a dynamic list keeps feeding the same people's dialer
  -- without anyone re-running Assign.
  SELECT array_agg(DISTINCT assigned_to) INTO v_owners
  FROM public.lead_list_members
  WHERE list_id = _list_id AND assigned_to IS NOT NULL;

  -- 1. Drop members that no longer match — but only while still pending.
  --    A worked/skipped member is call history and must survive a filter change.
  WITH gone AS (
    DELETE FROM public.lead_list_members m
     USING public.leads l
     WHERE m.list_id = _list_id
       AND l.id = m.lead_id
       AND m.work_status = 'pending'
       AND NOT public.lead_matches_filter(l, v_list.filter_definition)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_removed FROM gone;

  SELECT COALESCE(max(sort_order), 0) INTO v_next_order
  FROM public.lead_list_members WHERE list_id = _list_id;

  -- 2. Add new matches, round-robin across existing owners.
  --    assigned_at = now() keeps the previous-cycle floor (20260802100814)
  --    honest for freshly added members.
  PERFORM set_config('app.bulk_assign', 'on', true);

  WITH candidates AS (
    SELECT l.id AS lead_id,
           row_number() OVER (ORDER BY l.created_at, l.id) AS rn
    FROM public.leads l
    WHERE public.lead_matches_filter(l, v_list.filter_definition)
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_list_members m
         WHERE m.list_id = _list_id AND m.lead_id = l.id)
  ),
  inserted AS (
    INSERT INTO public.lead_list_members (
      list_id, lead_id, assigned_to, work_status, assigned_at, sort_order
    )
    SELECT _list_id,
           c.lead_id,
           CASE WHEN v_owners IS NULL THEN NULL
                ELSE v_owners[((c.rn - 1) % array_length(v_owners, 1)) + 1] END,
           'pending',
           CASE WHEN v_owners IS NULL THEN NULL ELSE v_now END,
           v_next_order + c.rn::int
    FROM candidates c
    ON CONFLICT (list_id, lead_id) DO NOTHING
    RETURNING lead_id, assigned_to
  )
  SELECT count(*)::int INTO v_added FROM inserted;

  -- Keep leads.counsellor_id in step with the list assignment, same as the
  -- round-robin RPC does, so the lead page and the dialer agree on ownership.
  IF v_owners IS NOT NULL AND v_added > 0 THEN
    UPDATE public.leads l
       SET counsellor_id = m.assigned_to,
           assigned_at = v_now
      FROM public.lead_list_members m
     WHERE m.list_id = _list_id
       AND m.lead_id = l.id
       AND m.assigned_at = v_now
       AND m.assigned_to IS NOT NULL
       AND l.counsellor_id IS DISTINCT FROM m.assigned_to;
  END IF;

  -- 3. Undialable members leave the pending count unless the list opted in.
  IF NOT v_list.include_terminal THEN
    PERFORM public.mark_call_list_undialable(_list_id);
  END IF;

  UPDATE public.lead_lists
     SET last_refreshed_at = v_now,
         member_count = (SELECT count(*) FROM public.lead_list_members WHERE list_id = _list_id)
   WHERE id = _list_id;

  -- 4. One summary notification per counsellor, and only when something arrived.
  IF v_added > 0 AND v_owners IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT p.user_id,
           'lead_assigned',
           'New leads in: ' || v_list.name,
           cnt.n || ' new lead' || CASE WHEN cnt.n = 1 THEN '' ELSE 's' END
             || ' matched this list. Open Cloud Dialer to call them.',
           '/cloud-dialer?list=' || _list_id
    FROM (
      SELECT m.assigned_to, count(*)::int AS n
      FROM public.lead_list_members m
      WHERE m.list_id = _list_id AND m.assigned_at = v_now AND m.assigned_to IS NOT NULL
      GROUP BY m.assigned_to
    ) cnt
    JOIN public.profiles p ON p.id = cnt.assigned_to
    WHERE p.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('added', v_added, 'removed', v_removed, 'skipped', false);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_dynamic_list_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_dynamic_list_members(uuid) TO authenticated;

-- ── Cron ────────────────────────────────────────────────────────────────────
-- Every 15 minutes, all day: leads arrive round the clock, and a dynamic list
-- that lags by hours is the frozen-list problem again with extra steps.

SELECT cron.unschedule('refresh-dynamic-lead-lists')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-dynamic-lead-lists');

SELECT cron.schedule(
  'refresh-dynamic-lead-lists',
  '*/15 * * * *',
  $$ SELECT public.resolve_dynamic_list_members(id)
       FROM public.lead_lists
      WHERE list_type = 'dynamic' AND is_active $$
);
