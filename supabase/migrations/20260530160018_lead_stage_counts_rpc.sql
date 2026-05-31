-- Single-query stage-count aggregation for the Dashboard funnel and the
-- Admissions pipeline header.
--
-- Both pages previously fanned out ~12-19 separate `count: 'exact', head: true`
-- queries — one per lead stage (Dashboard.tsx funnel, Admissions.tsx
-- fetchPipelineData). Each is a separate PostgREST round-trip + query plan, and
-- each re-evaluates the leads RLS policy over its stage's rows. This RPC
-- collapses them into a single GROUP BY scan: one round-trip, one plan, one RLS
-- pass over the filtered set.
--
-- SECURITY INVOKER (NOT definer): the leads RLS policy still applies exactly as
-- it did to the per-stage queries, so visibility is byte-for-byte identical for
-- every role — a counsellor still sees only their visible leads, an admin sees
-- the org/campus scope. This is a pure perf rewrite; it changes no visibility.
--
-- Params mirror the two call sites' existing scoping:
--   p_campus_id      — restrict to one campus (Dashboard "by campus", Admissions
--                      campus filter); NULL = all campuses.
--   p_counsellor_id  — restrict to one counsellor's leads (Admissions counsellor
--                      role); NULL = no counsellor filter.
--   p_exclude_mirror — drop is_mirror rows (Admissions, matching admissions_stats);
--                      Dashboard passes false to preserve its current behaviour.

CREATE OR REPLACE FUNCTION public.get_lead_stage_counts(
  p_campus_id      uuid    DEFAULT NULL,
  p_counsellor_id  uuid    DEFAULT NULL,
  p_exclude_mirror boolean DEFAULT false
)
RETURNS TABLE (stage text, count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT l.stage::text AS stage, COUNT(*)::bigint AS count
  FROM public.leads l
  WHERE (p_campus_id IS NULL OR l.campus_id = p_campus_id)
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (NOT p_exclude_mirror OR l.is_mirror = false)
  GROUP BY l.stage;
$$;

GRANT EXECUTE ON FUNCTION public.get_lead_stage_counts(uuid, uuid, boolean) TO authenticated;
