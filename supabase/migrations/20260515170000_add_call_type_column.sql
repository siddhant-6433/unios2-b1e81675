-- Add call_type to ai_call_records to distinguish AI vs manual calls
ALTER TABLE ai_call_records ADD COLUMN IF NOT EXISTS call_type TEXT NOT NULL DEFAULT 'ai';
-- Values: 'ai' (default, existing calls), 'manual' (click-to-call from CRM)

CREATE INDEX IF NOT EXISTS idx_ai_call_records_call_type ON ai_call_records (call_type);
