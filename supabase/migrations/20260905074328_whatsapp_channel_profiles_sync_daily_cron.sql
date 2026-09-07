-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905074328 name=whatsapp_channel_profiles_sync_daily_cron applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

SELECT cron.unschedule('whatsapp-channel-profiles-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-channel-profiles-sync');

SELECT cron.schedule(
  'whatsapp-channel-profiles-sync',
  '30 1 * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-channel-profiles-sync',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{}'::jsonb
    )
  $$
);
