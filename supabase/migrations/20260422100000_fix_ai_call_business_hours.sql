-- Fix 1: Business hours function for AI call scheduling
-- Calls should only be placed between 9 AM and 8 PM IST (3:30 UTC - 14:30 UTC)
CREATE OR REPLACE FUNCTION public.fn_next_business_hour(p_delay_minutes int DEFAULT 2)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  candidate timestamptz;
  ist_time time;
  ist_dow int; -- 0=Sun, 6=Sat
BEGIN
  candidate := now() + (p_delay_minutes || ' minutes')::interval;
  -- Convert to IST (UTC+5:30)
  ist_time := (candidate AT TIME ZONE 'Asia/Kolkata')::time;
  ist_dow := EXTRACT(DOW FROM candidate AT TIME ZONE 'Asia/Kolkata');

  -- If within business hours (9:00–19:59 IST, Mon-Sat), return as-is
  IF ist_time >= '09:00:00' AND ist_time < '20:00:00' AND ist_dow BETWEEN 1 AND 6 THEN
    RETURN candidate;
  END IF;

  -- Otherwise, schedule for 9:00 AM IST on next business day
  IF ist_time >= '20:00:00' THEN
    -- After 8 PM → next day 9 AM
    candidate := (date_trunc('day', candidate AT TIME ZONE 'Asia/Kolkata') + interval '1 day' + interval '9 hours') AT TIME ZONE 'Asia/Kolkata';
  ELSE
    -- Before 9 AM → same day 9 AM
    candidate := (date_trunc('day', candidate AT TIME ZONE 'Asia/Kolkata') + interval '9 hours') AT TIME ZONE 'Asia/Kolkata';
  END IF;

  -- Skip Sunday (DOW=0)
  ist_dow := EXTRACT(DOW FROM candidate AT TIME ZONE 'Asia/Kolkata');
  IF ist_dow = 0 THEN
    candidate := candidate + interval '1 day';
  END IF;

  RETURN candidate;
END;
$$;

-- Fix 2: Update the trigger to use business hours
CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_new_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip if flagged (bulk imports)
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;
  -- Skip if no phone
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  -- Insert into queue with business-hours-aware scheduling
  INSERT INTO ai_call_queue (lead_id, status, scheduled_at)
  VALUES (NEW.id, 'pending', fn_next_business_hour(2));

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block lead creation
  RAISE WARNING 'AI call queue insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Fix 3: Cleanup stale "initiated" records older than 30 min
-- These are calls where Plivo/voice-agent never sent a status callback
CREATE OR REPLACE FUNCTION public.fn_cleanup_stale_ai_calls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ai_call_records
  SET status = 'failed',
      summary = COALESCE(summary, '') || ' | Auto-closed: no status callback received within 30 minutes',
      completed_at = now()
  WHERE status = 'initiated'
    AND created_at < now() - interval '30 minutes';
END;
$$;

-- Run cleanup every 15 minutes
SELECT cron.schedule(
  'cleanup-stale-ai-calls',
  '*/15 * * * *',
  $$SELECT fn_cleanup_stale_ai_calls()$$
);
