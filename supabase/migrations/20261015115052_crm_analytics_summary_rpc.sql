-- keep-migration-version: already recorded on production schema_migrations
-- crm analytics summary rpc

-- Single authoritative, RLS-scoped aggregate for the CRM analytics overview.
-- Stage and source counts are complete and are not limited by PostgREST page size.
CREATE OR REPLACE FUNCTION public.get_crm_analytics_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH lead_facts AS MATERIALIZED (
    SELECT stage::text AS stage, source::text AS source
    FROM public.leads
  ),
  stage_totals AS (
    SELECT stage, count(*)::bigint AS lead_count
    FROM lead_facts
    GROUP BY stage
  ),
  source_totals AS (
    SELECT source, count(*)::bigint AS lead_count
    FROM lead_facts
    GROUP BY source
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'total_leads', (SELECT count(*) FROM lead_facts),
    'admitted_leads', (
      SELECT count(*) FROM lead_facts WHERE stage = 'admitted'
    ),
    'stage_counts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('stage', stage, 'count', lead_count)
        ORDER BY stage
      )
      FROM stage_totals
    ), '[]'::jsonb),
    'source_counts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('source', source, 'count', lead_count)
        ORDER BY source
      )
      FROM source_totals
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_crm_analytics_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_analytics_summary() TO authenticated;
