-- Enhance fn_dev_health_summary with cron failure details for widget drill-down.

CREATE OR REPLACE FUNCTION public.fn_dev_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Unauthorised' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'cron', (
      SELECT jsonb_build_object(
        'succeeded', count(*) FILTER (WHERE status = 'succeeded'),
        'failed',    count(*) FILTER (WHERE status = 'failed')
      )
      FROM cron.job_run_details
      WHERE start_time > now() - interval '1 hour'
    ),
    'cron_failures', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'job', j.jobname,
        'error', left(d.return_message, 200),
        'at', d.start_time
      ) ORDER BY d.start_time DESC), '[]'::jsonb)
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.start_time > now() - interval '1 hour'
        AND d.status = 'failed'
    ),
    'meta_leads_24h', (
      SELECT count(*)
      FROM public.meta_lead_events
      WHERE received_at > now() - interval '24 hours'
    ),
    'whatsapp', (
      SELECT jsonb_build_object(
        'sent_1h',   count(*) FILTER (WHERE status IN ('sent','delivered','read')),
        'failed_1h', count(*) FILTER (WHERE status = 'failed')
      )
      FROM public.whatsapp_messages
      WHERE created_at > now() - interval '1 hour'
        AND direction = 'outbound'
    ),
    'edge_errors', (
      SELECT jsonb_build_object(
        'err_401', count(*) FILTER (WHERE status_code = 401),
        'err_500', count(*) FILTER (WHERE status_code >= 500)
      )
      FROM net._http_response
      WHERE created > now() - interval '2 hours'
    ),
    'campaigns_stuck', (
      SELECT count(*)
      FROM public.whatsapp_campaigns
      WHERE status = 'sending'
        AND worker_locked_at < now() - interval '30 minutes'
    ),
    'ai_queue', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'failed',  count(*) FILTER (WHERE status = 'failed'
                     AND created_at > now() - interval '24 hours')
      )
      FROM public.ai_call_queue
    ),
    'checked_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dev_health_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dev_health_summary() TO authenticated;
