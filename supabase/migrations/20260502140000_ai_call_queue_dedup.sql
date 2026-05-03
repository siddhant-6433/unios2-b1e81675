-- Stop ai_call_queue from accumulating duplicate pending rows for the same
-- lead. Five different code paths (DB trigger + 4 edge functions) all insert
-- without coordination, so a single lead has been getting enqueued ~8x on
-- average. This migration:
--   1. Collapses existing pending duplicates to one row per lead (keeps the
--      oldest scheduled_at so the lead stays in the same FIFO slot).
--   2. Adds a partial unique index on (lead_id) WHERE status='pending' so
--      future duplicate inserts get rejected. Already-completed/failed/skipped
--      rows are unaffected — retries can still re-enqueue once the previous
--      attempt has cleared.
--
-- All insert call sites (DB trigger + edge functions) use ON CONFLICT DO
-- NOTHING / equivalent ignore-duplicate semantics so the rejection is
-- silent rather than throwing.

-- 1. Dedup existing pending rows
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY lead_id ORDER BY scheduled_at ASC, created_at ASC) AS rn
  FROM public.ai_call_queue
  WHERE status = 'pending'
)
DELETE FROM public.ai_call_queue
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Partial unique index — only one pending row per lead at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ai_call_queue_one_pending_per_lead
  ON public.ai_call_queue (lead_id)
  WHERE status = 'pending';

-- 3. Update the DB trigger to be conflict-tolerant.
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

  INSERT INTO ai_call_queue (lead_id, status, scheduled_at)
  VALUES (NEW.id, 'pending', fn_next_business_hour(2))
  ON CONFLICT (lead_id) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block lead creation
  RAISE WARNING 'AI call queue insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

COMMENT ON INDEX public.ai_call_queue_one_pending_per_lead IS
  'Enforces at most one pending queue entry per lead. Lets retries re-enqueue once the prior attempt has moved to completed / failed / skipped.';
