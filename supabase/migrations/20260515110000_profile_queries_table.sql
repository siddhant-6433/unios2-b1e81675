-- Profile Queries: non-admission WhatsApp queries for super admin review
-- These appear in a separate tab in UniOs

CREATE TABLE IF NOT EXISTS profile_queries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  query_text TEXT NOT NULL,
  ai_response TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending, responded, dismissed
  admin_response TEXT,
  responded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE INDEX idx_profile_queries_pending ON profile_queries (status, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX idx_profile_queries_phone ON profile_queries (phone);

ALTER TABLE profile_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on profile_queries"
  ON profile_queries
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
