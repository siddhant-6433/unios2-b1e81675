-- Super-admin controls to schedule the digitization auto-fill batch (library-enrich-batch edge fn).
-- The cron posts with the repo's shared x-cron-secret literal (same value the other crons use).

CREATE OR REPLACE FUNCTION public.library_set_enrich_cron(_enabled boolean, _minutes int DEFAULT 30)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_url text; v_sched text; v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can change the enrichment schedule';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-enrich-batch') THEN
    PERFORM cron.unschedule('library-enrich-batch');
  END IF;
  IF NOT _enabled THEN RETURN; END IF;
  v_sched := CASE WHEN coalesce(_minutes, 30) >= 60 THEN '0 * * * *' ELSE '*/30 * * * *' END;
  v_url := (SELECT value FROM public._app_config WHERE key = 'supabase_url');
  v_cmd := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','825230a9abd38418482572ca5ec24dbd06221ffa'),
      body := '{"limit":150}'::jsonb
    );
  $cmd$, v_url || '/functions/v1/library-enrich-batch');
  PERFORM cron.schedule('library-enrich-batch', v_sched, v_cmd);
END;
$$;

CREATE OR REPLACE FUNCTION public.library_get_enrich_cron()
RETURNS TABLE(enabled boolean, minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron
AS $$
  SELECT
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-enrich-batch' AND active),
    COALESCE((SELECT CASE WHEN schedule = '0 * * * *' THEN 60 ELSE 30 END FROM cron.job WHERE jobname = 'library-enrich-batch' LIMIT 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.library_set_enrich_cron(boolean, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_get_enrich_cron() TO authenticated;
