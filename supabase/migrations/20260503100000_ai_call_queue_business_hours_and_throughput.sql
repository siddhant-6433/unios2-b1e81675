-- Two changes to the AI call queue processor:
-- 1. Business-hours guard at the cron level — calls only fire 9 AM–8 PM IST
--    Mon-Sat. Outside this window the cron no-ops and the backlog waits for
--    the next business day. Previously the cron picked up rows whose
--    scheduled_at had passed regardless of current wall time, so a queue
--    that filled up at 7 PM kept draining until midnight.
-- 2. Process 2 rows per tick (was 1). Doubles throughput to ~120 calls/hour
--    so bulk publisher days clear the same business window instead of
--    bleeding into the next one.

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
  v_ist_hour int;
  v_ist_dow int;
  v_iter int;
BEGIN
  -- Business-hours guard: 9 AM ≤ hour < 20 (8 PM), Mon (1) – Sat (6)
  v_ist_hour := EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  v_ist_dow  := EXTRACT(DOW  FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  IF v_ist_hour < 9 OR v_ist_hour >= 20 OR v_ist_dow = 0 THEN
    RETURN; -- outside business hours
  END IF;

  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  -- Process up to 2 calls per cron tick (≈ 120 calls/hour during business hrs)
  FOR v_iter IN 1..2 LOOP
    SELECT * INTO v_item
    FROM ai_call_queue
    WHERE status = 'pending' AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_item IS NULL THEN RETURN; END IF; -- nothing left to process this tick

    -- Skip leads in terminal stages (e.g. marked Not Interested after enqueue)
    SELECT stage::text INTO v_lead_stage FROM leads WHERE id = v_item.lead_id;
    IF v_lead_stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
      UPDATE ai_call_queue
      SET status = 'skipped',
          error_message = 'Lead is in terminal stage: ' || v_lead_stage,
          completed_at = now()
      WHERE id = v_item.id;
      CONTINUE;
    END IF;

    UPDATE ai_call_queue SET status = 'processing', started_at = now() WHERE id = v_item.id;

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
  END LOOP;
END;
$$;

-- Helper RPC the dashboard calls to pull a clean status snapshot in one round-trip.
CREATE OR REPLACE FUNCTION public.fn_ai_call_queue_status()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT
      count(*) FILTER (WHERE status = 'pending')                  AS pending,
      count(*) FILTER (WHERE status = 'pending' AND scheduled_at <= now())  AS pending_due,
      count(*) FILTER (WHERE status = 'processing')               AS processing,
      count(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '1 hour') AS completed_1h,
      count(*) FILTER (WHERE status = 'completed' AND completed_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS completed_today,
      count(*) FILTER (WHERE status = 'failed'    AND completed_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS failed_today,
      count(*) FILTER (WHERE status = 'skipped'   AND completed_at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS skipped_today,
      max(completed_at) FILTER (WHERE status = 'completed')       AS last_completed_at,
      min(scheduled_at) FILTER (WHERE status = 'pending')         AS next_scheduled_at
    FROM ai_call_queue
  ),
  by_source AS (
    SELECT coalesce(l.source::text, 'unknown') AS source, count(*) AS pending
    FROM ai_call_queue q JOIN leads l ON l.id = q.lead_id
    WHERE q.status = 'pending'
    GROUP BY 1
    ORDER BY 2 DESC
  ),
  business AS (
    SELECT
      EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata')::int >= 9
       AND EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata')::int < 20
       AND EXTRACT(DOW  FROM now() AT TIME ZONE 'Asia/Kolkata')::int <> 0 AS in_business_hours,
      now() AT TIME ZONE 'Asia/Kolkata' AS ist_now
  )
  SELECT json_build_object(
    'pending',          (SELECT pending          FROM counts),
    'pending_due',      (SELECT pending_due      FROM counts),
    'processing',       (SELECT processing       FROM counts),
    'completed_1h',     (SELECT completed_1h     FROM counts),
    'completed_today',  (SELECT completed_today  FROM counts),
    'failed_today',     (SELECT failed_today     FROM counts),
    'skipped_today',    (SELECT skipped_today    FROM counts),
    'last_completed_at',(SELECT last_completed_at FROM counts),
    'next_scheduled_at',(SELECT next_scheduled_at FROM counts),
    'in_business_hours',(SELECT in_business_hours FROM business),
    'ist_now',          (SELECT ist_now           FROM business),
    'by_source',        (SELECT COALESCE(json_agg(json_build_object('source', source, 'pending', pending)), '[]'::json) FROM by_source)
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_ai_call_queue_status() TO authenticated, anon;
