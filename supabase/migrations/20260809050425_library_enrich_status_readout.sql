-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260809050425 name=library_enrich_status_readout applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.library_enrich_status()
RETURNS TABLE(
  enabled boolean,
  minutes int,
  last_run timestamptz,
  last_processed timestamptz,
  enriched bigint,
  no_match bigint,
  remaining bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron
AS $$
  SELECT
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-enrich-batch' AND active),
    COALESCE((SELECT CASE WHEN schedule = '0 * * * *' THEN 60 ELSE 30 END FROM cron.job WHERE jobname = 'library-enrich-batch' LIMIT 1), 30),
    (SELECT max(d.start_time) FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = 'library-enrich-batch'),
    (SELECT max(updated_at) FROM public.library_digitization_records WHERE enrichment_status IS NOT NULL),
    (SELECT count(*) FROM public.library_digitization_records WHERE enrichment_status = 'enriched'),
    (SELECT count(*) FROM public.library_digitization_records WHERE enrichment_status = 'no_match'),
    (SELECT count(*) FROM public.library_digitization_records WHERE enrichment_status IS NULL AND status IN ('captured','matched','needs_review'));
$$;
GRANT EXECUTE ON FUNCTION public.library_enrich_status() TO authenticated;
