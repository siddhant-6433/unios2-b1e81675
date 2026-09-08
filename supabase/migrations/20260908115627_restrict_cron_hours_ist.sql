-- Park heavy pg_cron work off calling hours.
-- pg_cron is UTC. IST = UTC+5:30.
--   Day window   hours 3-12 UTC  ≈ 9:00am–6:30pm IST
--   Night window hours 13-23,0-3 UTC ≈ 6:30pm–9:30am IST
-- Minute / DOW cadence is kept so queues still drain; only the hour field
-- changes. Commands are not rewritten (no secrets copied). Missing jobs are
-- skipped so a partial install cannot abort the rest.
--
-- 24/7 (left alone): process-whatsapp-status-queue, whatsapp-buffer-worker,
-- flush-scheduled-wa-sends, meta-leads-poll, easebuzz-lead-payment-reconcile,
-- easebuzz-lead-payment-reconcile-fast, reconcile-icici-pending,
-- razorpay-order-reconcile, payment-link-reconcile, cleanup-pgnet-http-response.

CREATE OR REPLACE FUNCTION public.library_set_enrich_cron(_enabled boolean, _minutes int DEFAULT 30)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_sched text;
  v_cmd text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only a super admin can change the enrichment schedule';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-enrich-batch') THEN
    PERFORM cron.unschedule('library-enrich-batch');
  END IF;
  IF NOT _enabled THEN RETURN; END IF;

  -- Night-only: 6:30pm–9:30am IST. Hourly vs every 30 min still follows _minutes.
  v_sched := CASE
    WHEN coalesce(_minutes, 30) >= 60 THEN '0 13-23,0-3 * * *'
    ELSE '*/30 13-23,0-3 * * *'
  END;

  SELECT coalesce(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1),
    (SELECT value FROM public._app_config WHERE key = 'supabase_url')
  ) INTO v_url;
  SELECT coalesce(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1),
    ''
  ) INTO v_secret;
  IF v_url IS NULL THEN RETURN; END IF;

  v_cmd := format(
    $cmd$SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', %L
      ),
      body := '{"limit":150}'::jsonb
    );$cmd$,
    v_url || '/functions/v1/library-enrich-batch',
    v_secret
  );
  PERFORM cron.schedule('library-enrich-batch', v_sched, v_cmd);
END;
$$;

CREATE OR REPLACE FUNCTION public.library_get_enrich_cron()
RETURNS TABLE(enabled boolean, minutes int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-enrich-batch' AND active),
    COALESCE((
      SELECT CASE
        WHEN schedule LIKE '0 %' THEN 60
        ELSE 30
      END
      FROM cron.job
      WHERE jobname = 'library-enrich-batch'
      LIMIT 1
    ), 30);
$$;

REVOKE ALL ON FUNCTION public.library_set_enrich_cron(boolean, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.library_get_enrich_cron() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_set_enrich_cron(boolean, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_get_enrich_cron() TO authenticated;

DO $windows$
DECLARE
  rec record;
  v_jobid bigint;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- Day: 9am–6pm IST. Keep existing cadence.
      ('process-ai-call-queue',            '* 3-12 * * *'),
      ('ai-call-failed-handler',           '*/30 3-12 * * 1-6'),
      ('cleanup-stale-ai-calls',           '*/5 3-12 * * *'),
      ('reconcile-stale-live-calls',       '*/2 3-12 * * *'),
      ('process-wa-classification-queue',  '* 3-12 * * *'),
      ('marketing-campaign-dispatcher',    '* 3-12 * * *'),
      ('finalize-stranded-campaigns',      '*/5 3-12 * * *'),
      ('sla-auto-reclaim',                 '*/15 3-12 * * *'),
      ('lead-velocity-check',              '*/15 3-12 * * *'),
      ('counsellor-reminders',             '*/15 3-12 * * *'),
      ('lead-bucket-backlog',              '0,30 3-12 * * 1-6'),
      ('email-ai-reply',                   '*/5 3-12 * * *'),
      ('feedback-sender',                  '*/30 3-12 * * *'),
      ('token-fee-reminders',              '0 3-12 * * *'),

      -- Night: 6pm–9am IST.
      ('counsellor-call-miner',            '*/2 13-23,0-3 * * *'),
      ('whatsapp-reply-learning-hourly',   '15 13-23,0-3 * * *'),
      ('refresh-dynamic-lead-lists',       '*/15 13-23,0-3 * * *'),
      ('zoho-books-poll',                  '*/15 13-23,0-3 * * *'),
      ('whatsapp-templates-sync',          '30 13-23,0-3 * * *'),
      ('whatsapp-route-health',            '*/15 13-23,0-3 * * *'),
      ('process-student-photo-jobs',       '* 13-23,0-3 * * *'),
      ('receipt-pdf-backfill',             '*/10 13-23,0-3 * * *'),
      ('library-enrich-batch',             '*/30 13-23,0-3 * * *'),
      ('cleanup-whatsapp-status-queue',    '15 13-23,0-3 * * *'),
      ('provision-orphan-students',        '15 0,13,18,21 * * *'),
      ('finance-stale-orphan-alert',       '30 14,18,2 * * *'),
      ('meta-leadgen-silence-check',       '30 18 * * *'),
      ('exam-registration-check-daily',    '30 18 * * *'),
      ('counselling-watch',                '30 1,18 * * *')
    ) AS t(jobname, schedule)
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = rec.jobname;
    IF v_jobid IS NULL THEN
      RAISE NOTICE 'cron % not installed, skipping', rec.jobname;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM cron.alter_job(v_jobid, schedule := rec.schedule);
    EXCEPTION WHEN undefined_function THEN
      UPDATE cron.job SET schedule = rec.schedule WHERE jobid = v_jobid;
    END;
  END LOOP;
END;
$windows$;
