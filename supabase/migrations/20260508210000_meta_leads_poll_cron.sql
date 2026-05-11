-- Schedule Meta Lead Ads polling every 5 minutes.
--
-- Polls both NIMT pages for new leads on all lead forms, then forwards
-- to lead-ingest. Duplicates are dropped by the unique index on
-- meta_leadgen_id. No webhook subscription or Lead Access Manager needed.

SELECT cron.schedule(
  'meta-leads-poll',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/meta-leads-poll',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);
