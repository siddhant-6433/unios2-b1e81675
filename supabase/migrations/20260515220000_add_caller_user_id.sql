-- Track which counsellor placed the call (for live call monitoring)
ALTER TABLE ai_call_records ADD COLUMN IF NOT EXISTS caller_user_id uuid;
