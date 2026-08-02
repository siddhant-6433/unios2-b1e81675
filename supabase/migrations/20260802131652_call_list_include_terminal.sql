-- Assigning a list should be able to INCLUDE cold / not-interested leads.
--
-- 20260802115927 made terminal-stage members not_dialable unconditionally, which
-- is right for a normal push and exactly wrong for a win-back campaign. The
-- lead_lists.include_terminal flag (added in 20260802131616) now drives it, and
-- three things have to read the same flag or the list becomes unfinishable
-- again: the marker, the queue, and the preview the assigner sees.
--
-- Phone-less leads stay excluded regardless — there is nothing to dial.
-- (In practice leads.phone is NOT NULL, so that guard is belt-and-braces.)

CREATE OR REPLACE FUNCTION public.mark_call_list_undialable(_list_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH marked AS (
    UPDATE public.lead_list_members m
       SET work_status = 'not_dialable'
      FROM public.leads l, public.lead_lists ll
     WHERE m.list_id = _list_id
       AND ll.id = _list_id
       AND l.id = m.lead_id
       AND m.work_status = 'pending'
       AND (
         l.phone IS NULL
         OR (NOT ll.include_terminal
             AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted','cold'))
       )
    RETURNING 1
  )
  SELECT count(*)::integer FROM marked;
$$;

REVOKE ALL ON FUNCTION public.mark_call_list_undialable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_call_list_undialable(uuid) TO authenticated;

-- The queue must read the same flag. Hardcoding the terminal filter here while
-- the members stay 'pending' is exactly the unfinishable-list bug fixed in
-- 20260802115927 — the two rules have to move together.
CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue(
  p_list_id       uuid,
  p_counsellor_id uuid    DEFAULT NULL,
  p_limit         integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH cfg AS (
  SELECT COALESCE(include_terminal, false) AS include_terminal
  FROM public.lead_lists WHERE id = p_list_id
),
members AS (
  SELECT m.lead_id, m.sort_order, m.added_at
  FROM public.lead_list_members m
  JOIN public.leads l ON l.id = m.lead_id
  CROSS JOIN cfg
  WHERE m.list_id = p_list_id
    AND m.work_status = 'pending'
    AND l.phone IS NOT NULL
    AND (cfg.include_terminal
         OR l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold'))
    AND (p_counsellor_id IS NULL OR m.assigned_to = p_counsellor_id)
  ORDER BY m.sort_order NULLS LAST, m.added_at
  LIMIT GREATEST(1, LEAST(p_limit, 1000))
),
attempts AS (
  SELECT acr.lead_id, count(*)::int AS attempt_count
  FROM public.ai_call_records acr
  WHERE acr.call_type = 'manual'
    AND acr.status <> 'counsellor_no_answer'
    AND acr.lead_id IN (SELECT lead_id FROM members)
  GROUP BY acr.lead_id
),
enriched AS (
  SELECT
    l.id, l.name, l.phone, l.stage, l.source, l.course_id,
    COALESCE(c.name, '—')   AS course_name,
    c.fee_per_year          AS course_fee_per_year,
    COALESCE(cmp.name, '—') AS campus_name,
    'Call List'::text       AS bucket,
    0                       AS bucket_priority,
    COALESCE(a.attempt_count, 0) AS attempt_count,
    l.assigned_at, l.first_contact_at,
    NULL::uuid AS followup_id,
    NULL::text AS followup_type,
    row_number() OVER (ORDER BY m.sort_order NULLS LAST, m.added_at) AS list_position
  FROM members m
  JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.courses c    ON c.id   = l.course_id
  LEFT JOIN public.campuses cmp ON cmp.id = l.campus_id
  LEFT JOIN attempts a          ON a.lead_id = m.lead_id
)
SELECT jsonb_build_object(
  'queue', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.list_position) FROM enriched e),
    '[]'::jsonb
  ),
  'buckets', CASE
    WHEN (SELECT count(*) FROM enriched) > 0 THEN jsonb_build_array(jsonb_build_object(
      'bucket_priority', 0, 'label', 'Call List',
      'count', (SELECT count(*)::int FROM enriched)
    ))
    ELSE '[]'::jsonb
  END
);
$$;

REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated;

-- Effective length BEFORE committing, so the assign dialog can say
-- "38 in list → 25 will be dialable" instead of the assigner finding out later.
CREATE OR REPLACE FUNCTION public.preview_call_list_assignment(
  _list_id uuid,
  _include_terminal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',    count(*)::int,
    'no_phone', count(*) FILTER (WHERE l.phone IS NULL)::int,
    'terminal', count(*) FILTER (
                  WHERE l.phone IS NOT NULL
                    AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted','cold'))::int,
    'dialable', count(*) FILTER (
                  WHERE l.phone IS NOT NULL
                    AND (_include_terminal
                         OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted','cold')))::int
  )
  FROM public.lead_list_members m
  JOIN public.leads l ON l.id = m.lead_id
  WHERE m.list_id = _list_id;
$$;

REVOKE ALL ON FUNCTION public.preview_call_list_assignment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_call_list_assignment(uuid, boolean) TO authenticated;

-- assign_lead_list_round_robin gains _include_terminal, persists it on the list,
-- and its notification now counts only DIALABLE leads and names the destination
-- ("Open Cloud Dialer to start.") so the count agrees with the dialer banner.
-- Patched against the live definition rather than restated in full: the body is
-- ~250 lines and duplicating it here is how the two copies drift.
DO $do$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assign_lead_list_round_robin'
   LIMIT 1;
  IF src IS NULL THEN RETURN; END IF;

  IF position('include_terminal = _include_terminal' in src) = 0 THEN
    src := replace(src,
      '     SET purpose = ''calling'',' || E'\n' || '         is_active = true,',
      '     SET purpose = ''calling'',' || E'\n' || '         is_active = true,' || E'\n' ||
      '         include_terminal = _include_terminal,');
  END IF;

  IF position('JOIN public.leads l ON l.id = a.lead_id' in src) = 0 THEN
    src := replace(src,
      '    SELECT a.counsellor_id, count(*)::integer AS n' || E'\n' ||
      '    FROM _assignments a GROUP BY a.counsellor_id',
      '    SELECT a.counsellor_id, count(*)::integer AS n' || E'\n' ||
      '    FROM _assignments a' || E'\n' ||
      '    JOIN public.leads l ON l.id = a.lead_id' || E'\n' ||
      '    WHERE l.phone IS NOT NULL' || E'\n' ||
      '      AND (_include_terminal OR l.stage NOT IN (''not_interested'',''dnc'',''rejected'',''ineligible'',''admitted'',''cold''))' || E'\n' ||
      '    GROUP BY a.counsellor_id');
  END IF;

  IF position('Open Cloud Dialer to start' in src) = 0 THEN
    src := replace(src,
      '           || COALESCE(''. '' || _priority_note, ''''),',
      '           || COALESCE(''. '' || _priority_note, '''')' || E'\n' ||
      '           || ''. Open Cloud Dialer to start.'',');
  END IF;

  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin(
      _list_id uuid,
      _counsellor_ids uuid[],
      _only_unassigned boolean DEFAULT false,
      _priority_note text DEFAULT NULL,
      _due_date date DEFAULT NULL,
      _include_terminal boolean DEFAULT false
    )
    RETURNS TABLE (
      batch_id uuid, counsellor_id uuid, counsellor_name text,
      assigned_count integer, failed_count integer
    )
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L
  $fmt$, src);
END $do$;

-- Retire the 5-arg version so the optional 6th arg can't create an ambiguous call.
DROP FUNCTION IF EXISTS public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date);
REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean) TO authenticated;
