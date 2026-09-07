-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260802112927 name=zoho_books_poll_cron applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

SELECT cron.unschedule('zoho-books-poll')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'zoho-books-poll');

SELECT cron.schedule(
  'zoho-books-poll',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/zoho-books-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
