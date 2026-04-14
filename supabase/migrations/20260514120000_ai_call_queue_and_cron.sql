-- AI Call Queue: holds pending AI calls from bulk imports.
-- A cron job processes them one at a time every 30 seconds.

CREATE TABLE IF NOT EXISTS public.ai_call_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  requested_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_call_queue_pending ON public.ai_call_queue(status, scheduled_at)
  WHERE status = 'pending';

ALTER TABLE public.ai_call_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ai_call_queue"
  ON public.ai_call_queue FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT ALL ON public.ai_call_queue TO authenticated;
GRANT ALL ON public.ai_call_queue TO service_role;

-- Cron function: picks up the next pending call and fires it
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

-- Cron: run every 30 seconds (Supabase pg_cron minimum is 1 minute, so we use 1 min)
-- Each run processes ONE call. With 1-minute interval, 60 calls/hour.
SELECT cron.schedule(
  'process-ai-call-queue',
  '* * * * *',  -- every minute
  $$SELECT fn_process_ai_call_queue()$$
);
