-- Cold leads are dialable in call lists by default.
--
-- 'cold' means the lead went quiet / unresponsive (classifyInactive), not that
-- they said no. Unlike a real terminal (not_interested / dnc / rejected /
-- ineligible / admitted), a cold lead is exactly who a counsellor should be
-- re-attempting. Lumping it into the not_dialable terminal set meant every call
-- list silently dropped its cold members unless the assigner flipped
-- include_terminal — which also drags in the genuinely-dead stages.
--
-- Fix: drop 'cold' from the terminal set in the four call-list functions that
-- share it (marker, queue, preview, assign notification). include_terminal
-- still governs the real terminals. Nothing outside the call-list/dialer path
-- changes: cold stays "exited the funnel" for badges, follow-up SLAs, and the
-- admissions funnel.

-- ── 1. Marker: cold members stay pending (dialable) ──────────────────────────
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
             AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted'))
       )
    RETURNING 1
  )
  SELECT count(*)::integer FROM marked;
$$;

REVOKE ALL ON FUNCTION public.mark_call_list_undialable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_call_list_undialable(uuid) TO authenticated;

-- ── 2. Dialer queue: cold members are dialed ─────────────────────────────────
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
         OR l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted'))
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

-- ── 3. Assign preview: cold counts as dialable, not terminal ─────────────────
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
                    AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted'))::int,
    'dialable', count(*) FILTER (
                  WHERE l.phone IS NOT NULL
                    AND (_include_terminal
                         OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted')))::int
  )
  FROM public.lead_list_members m
  JOIN public.leads l ON l.id = m.lead_id
  WHERE m.list_id = _list_id;
$$;

REVOKE ALL ON FUNCTION public.preview_call_list_assignment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_call_list_assignment(uuid, boolean) TO authenticated;

-- ── 4. assign_lead_list_round_robin notification count: same terminal set ────
-- The body is ~250 lines and was itself assembled by string-patching the live
-- source; restating it in full is how the two copies drift. Take the full,
-- exact CREATE statement from pg_get_functiondef (correct signature and all),
-- strip 'cold' from its terminal tuple (both quote/space spellings), and
-- re-run it. Idempotent: a no-op once 'cold' is already gone.
DO $do$
DECLARE def text; newdef text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assign_lead_list_round_robin' LIMIT 1;
  IF def IS NULL THEN RETURN; END IF;

  newdef := replace(def, '''admitted'',''cold''', '''admitted''');
  newdef := replace(newdef, '''admitted'', ''cold''', '''admitted''');

  IF newdef <> def THEN
    EXECUTE newdef;
  END IF;
END
$do$;

-- ── 5. Backfill: un-park cold members already sitting as not_dialable ────────
-- Only those parked solely for being cold (have a phone). Phone-less cold
-- members stay not_dialable — nothing to dial. Only active calling lists.
UPDATE public.lead_list_members m
   SET work_status = 'pending'
  FROM public.leads l, public.lead_lists ll
 WHERE ll.id = m.list_id
   AND ll.purpose = 'calling'
   AND ll.is_active
   AND l.id = m.lead_id
   AND m.work_status = 'not_dialable'
   AND l.phone IS NOT NULL
   AND l.stage = 'cold';
