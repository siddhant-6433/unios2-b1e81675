-- Cloud-dialer queue: authorize by call-list membership, not lead RLS.
--
-- Bug: an assigned call list showed "31/54" in the header but "No leads in
-- queue". The count RPC my_call_lists() is SECURITY DEFINER and counts straight
-- from lead_list_members (assignment = authorization), whereas
-- cloud_dialer_campaign_queue() was SECURITY INVOKER, so its `JOIN leads` was
-- filtered by can_view_lead RLS. can_view_lead has no call-list path, so when a
-- head builds a list from leads owned by *other* counsellors, the assigned
-- counsellor can work them per the count but the dialer queue returns 0 rows.
-- Prod: 612 of 1,068 dialable-pending assigned members (57%), across 26 of 29
-- active lists, were hidden this way.
--
-- Fix: flip the queue to SECURITY DEFINER and self-enforce scope the same way
-- my_call_lists does — derive v_profile_id / v_is_admin from auth.uid(), force
-- non-admins to their own assigned members, let admins target any counsellor
-- (NULL = org-wide). Signature unchanged so the frontend needs no changes.

CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue(
  p_list_id       uuid,
  p_counsellor_id uuid    DEFAULT NULL,
  p_limit         integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_is_admin   boolean;
  v_result     jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

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
      -- Authorize by list membership (assignment), not lead RLS. Admins may
      -- target any counsellor (NULL = org-wide); counsellors are forced to
      -- their own assigned members regardless of the param they pass.
      AND (
        (v_is_admin AND (p_counsellor_id IS NULL OR m.assigned_to = p_counsellor_id))
        OR (NOT v_is_admin AND m.assigned_to = v_profile_id)
      )
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
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated;
