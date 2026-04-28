-- Fix: AI call queue should skip leads in terminal stages.
-- Previously, queued calls would fire even after a lead was marked Not Interested.

CREATE OR REPLACE FUNCTION public.fn_process_ai_call_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_url text;
  v_key text;
  v_lead_stage text;
BEGIN
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  -- Pick the next pending item whose scheduled time has passed
  SELECT * INTO v_item
  FROM ai_call_queue
  WHERE status = 'pending' AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_item IS NULL THEN RETURN; END IF;

  -- Check if lead is in a terminal stage — skip the call if so
  SELECT stage::text INTO v_lead_stage FROM leads WHERE id = v_item.lead_id;
  IF v_lead_stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    UPDATE ai_call_queue
    SET status = 'skipped',
        error_message = 'Lead is in terminal stage: ' || v_lead_stage,
        completed_at = now()
    WHERE id = v_item.id;
    RETURN;
  END IF;

  -- Mark as processing
  UPDATE ai_call_queue SET status = 'processing', started_at = now() WHERE id = v_item.id;

  -- Fire the AI call via pg_net
  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/voice-call',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'action', 'outbound',
        'lead_id', v_item.lead_id
      )
    );
    UPDATE ai_call_queue SET status = 'completed', completed_at = now() WHERE id = v_item.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE ai_call_queue SET status = 'failed', error_message = SQLERRM, completed_at = now() WHERE id = v_item.id;
  END;
END;
$$;
