-- Tighten the stuck-call reconciler — 30-min timeout left zombie call
-- records visible in the LiveCallBar popup for almost the full window
-- (its display cutoff was also 30 min). Real calls finish in well under
-- 10 minutes; anything older is stuck (Plivo webhook never reached the
-- voice-agent, the agent crashed, etc.).
--
-- Two changes:
--   1. Mark stuck 'initiated' as 'failed' after 10 min instead of 30.
--   2. Run the cleanup every 5 min instead of every 15 — at 32 stuck
--      records/hour observed (mostly outbound AI queue calls), the
--      backlog can build up otherwise.
--
-- The LiveCallBar's own display cutoff is reduced to 7 min in code so
-- the popup never outlives the next reconciler tick.

CREATE OR REPLACE FUNCTION public.fn_cleanup_stale_ai_calls()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ai_call_records
  SET status = 'failed',
      summary = COALESCE(summary, '') || ' | Auto-closed: no status callback received within 10 minutes',
      completed_at = now()
  WHERE status = 'initiated'
    AND created_at < now() - interval '10 minutes';
END;
$$;

-- Replace the existing 15-minute schedule with a 5-minute one.
SELECT cron.unschedule('cleanup-stale-ai-calls');
SELECT cron.schedule(
  'cleanup-stale-ai-calls',
  '*/5 * * * *',
  $$SELECT fn_cleanup_stale_ai_calls()$$
);

-- One-shot drain of the current backlog so the user stops seeing zombie
-- LiveCallBar entries immediately (32+ stuck records as of deploy).
SELECT public.fn_cleanup_stale_ai_calls();
