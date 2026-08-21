-- Per-cron-job detail for the /admin/system-health page.

CREATE OR REPLACE FUNCTION public.fn_dev_cron_detail()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Unauthorised' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.jobname), '[]'::jsonb)
    FROM (
      SELECT
        j.jobid,
        j.jobname,
        j.schedule,
        j.active,
        (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) as last_status,
        (SELECT d.start_time FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) as last_run,
        (SELECT left(d.return_message, 300) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed' ORDER BY d.start_time DESC LIMIT 1) as last_error,
        (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '1 hour') as runs_1h,
        (SELECT count(*) FILTER (WHERE d.status = 'failed') FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.start_time > now() - interval '1 hour') as fails_1h
      FROM cron.job j
      WHERE j.active = true
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dev_cron_detail() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dev_cron_detail() TO authenticated;
