-- Funnel ALL AI-call enqueues through ai_call_queue + the per-minute cron,
-- and make the delay source-aware so real-time intent (website / meta / google)
-- jumps ahead of bulk publisher dumps in the FIFO order.
--
-- Two changes:
-- 1. Drop the legacy "fire voice-call immediately on lead INSERT" trigger
--    (was running in parallel to the queue, causing duplicate calls,
--    no business-hours guard, no rate limit).
-- 2. Rewrite fn_auto_ai_call_new_lead with source classification:
--      • Real-time → 4 min delay (or +4 min into next business window)
--      • Bulk publishers → 30 min delay (real-time leads land first by scheduled_at)
--      • Counsellor / consultant / walk-in / reference → no enqueue
--        (a human is already on the lead)

DROP TRIGGER IF EXISTS trg_auto_ai_call_on_lead_create ON public.leads;
DROP FUNCTION IF EXISTS public.fn_auto_ai_call_on_lead_create();

CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_new_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay_min int;
BEGIN
  -- Hard skip flags — bulk imports set this, manual override always wins
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  -- Source classification — see migration header for the design rationale
  CASE NEW.source
    WHEN 'website', 'website_chat', 'meta_ads', 'google_ads', 'enquiry'
      THEN v_delay_min := 4;
    WHEN 'collegedunia', 'collegehai', 'salahlo', 'justdial', 'mirai_website'
      THEN v_delay_min := 30;
    WHEN 'consultant', 'walk_in', 'reference'
      THEN RETURN NEW; -- skip — human is already on it
    ELSE v_delay_min := 4; -- unknown source defaults to real-time
  END CASE;

  INSERT INTO ai_call_queue (lead_id, status, scheduled_at)
  VALUES (NEW.id, 'pending', fn_next_business_hour(v_delay_min))
  ON CONFLICT (lead_id) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AI call queue insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
