-- add ai call records live call guard index

-- manual-call refuses to ring a counsellor who already has a live bridge call
-- (status initiated/in_progress) to prevent simultaneous calls to their phone.
-- This partial index keeps that per-caller lookup off a sequential scan of the
-- hot ai_call_records table.
CREATE INDEX IF NOT EXISTS idx_ai_call_records_live_by_caller
  ON public.ai_call_records (caller_user_id, created_at DESC)
  WHERE caller_user_id IS NOT NULL
    AND status IN ('initiated', 'in_progress');
