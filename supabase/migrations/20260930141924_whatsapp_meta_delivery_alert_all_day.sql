-- whatsapp meta delivery alert all day
-- Campaigns run during the daytime window, so the WhatsApp health monitor
-- must also check for delivery blocks during those hours.
DO $schedule$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'whatsapp-route-health';

  IF v_jobid IS NOT NULL THEN
    BEGIN
      PERFORM cron.alter_job(v_jobid, schedule := '*/15 * * * *');
    EXCEPTION WHEN undefined_function THEN
      UPDATE cron.job SET schedule = '*/15 * * * *' WHERE jobid = v_jobid;
    END;
  END IF;
END;
$schedule$;
