-- Daily sync of WhatsApp number identity (name + logo) from Meta.
--
-- Context: whatsapp-channel-profiles-sync pulls each Meta number's verified_name
-- and rehosted profile_picture_url from Graph and stores them on whatsapp_channels
-- so every UI (Marketing sender picker, WhatsApp inbox number list) reads one
-- canonical source instead of hardcoding the NIMT logo/name. Until now that sync
-- was only ever run by hand, so the stored identity went stale. Run it once a day.

SELECT cron.unschedule('whatsapp-channel-profiles-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-channel-profiles-sync');

SELECT cron.schedule(
  'whatsapp-channel-profiles-sync',
  '30 1 * * *', -- 01:30 UTC ≈ 07:00 IST, once daily
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
