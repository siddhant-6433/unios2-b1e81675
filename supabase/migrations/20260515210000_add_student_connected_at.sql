-- Track when the student actually answers a bridge call
-- Used by Cloud Dialer to show disposition buttons only after student connects
ALTER TABLE ai_call_records ADD COLUMN IF NOT EXISTS student_connected_at timestamptz;
