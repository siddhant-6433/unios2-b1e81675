-- Reconcile live-call rows when Plivo / voice-agent callbacks never arrive.
-- This prevents ai_call_records from staying status='initiated' forever and
-- keeps the global LiveCallBar from treating dead calls as live.

CREATE OR REPLACE FUNCTION public.reconcile_stale_live_calls(
  p_stale_after_seconds integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stale_after integer := LEAST(GREATEST(COALESCE(p_stale_after_seconds, 90), 45), 600);
  v_is_admin boolean := false;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  v_is_admin := public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'admission_head'::app_role)
    OR public.has_role(v_uid, 'campus_admin'::app_role);

  UPDATE public.ai_call_records acr
  SET
    status = 'no_answer',
    disposition = COALESCE(acr.disposition, 'not_answered'),
    duration_seconds = COALESCE(acr.duration_seconds, 0),
    completed_at = COALESCE(acr.completed_at, now()),
    summary = COALESCE(acr.summary, 'Cloud Call timed out before connection')
  WHERE acr.status = 'initiated'
    AND acr.call_type IN ('manual', 'inbound')
    AND acr.completed_at IS NULL
    AND acr.student_connected_at IS NULL
    AND acr.disposition IS NULL
    AND acr.created_at < now() - (v_stale_after || ' seconds')::interval
    AND (v_is_admin OR acr.caller_user_id = v_uid);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_stale_live_calls(integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
