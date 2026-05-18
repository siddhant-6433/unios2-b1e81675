-- Lightweight count RPC for the global action bar's "Reclaim soon" chip.
-- The SLA window is per-source (see source_sla_config from 20260610120000),
-- so the count can't be a single client-side WHERE clause. This RPC does the
-- join + interval math server-side and returns one integer.
--
-- p_within_min: how many minutes ahead to look. 30 = "reclaim now or in
-- the next half hour"; the GlobalActionBar uses this to nudge the counsellor
-- before the auto-reclaim cron actually unassigns the lead.

CREATE OR REPLACE FUNCTION public.fn_count_leads_reclaim_soon(
  p_counsellor_id uuid,
  p_within_min    integer DEFAULT 30
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.leads l
  LEFT JOIN public.source_sla_config s ON s.source = l.source::text
  WHERE l.counsellor_id = p_counsellor_id
    AND l.assigned_at IS NOT NULL
    AND l.first_contact_at IS NULL
    AND l.stage IN ('new_lead'::lead_stage, 'ai_called'::lead_stage)
    AND l.assigned_at + (COALESCE(s.first_contact_hours, 24) || ' hours')::interval
        < now() + (p_within_min || ' minutes')::interval;
$$;

GRANT EXECUTE ON FUNCTION public.fn_count_leads_reclaim_soon(uuid, integer) TO authenticated;
