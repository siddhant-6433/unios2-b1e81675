-- Web Chat Tables for NIMT Website Chat Counsellor
-- Creates knowledge_gaps and web_conversations tables

-- ── knowledge_gaps: unanswered queries for human review ─────────────────────

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_text TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  -- context shape: { "course": "BCA", "campus": "Greater Noida", "lead_id": "uuid" }
  source TEXT NOT NULL DEFAULT 'web_chat',
  -- source: web_chat, phone_agent, whatsapp
  confidence_score REAL NOT NULL DEFAULT 0,
  -- 0.0 = no match, 0.5 = partial, 1.0 = full match
  status TEXT NOT NULL DEFAULT 'pending',
  -- status: pending, answered, dismissed
  answer_text TEXT,
  answered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

-- Index for admin review (pending gaps, newest first)
CREATE INDEX idx_knowledge_gaps_pending ON knowledge_gaps (status, created_at DESC)
  WHERE status = 'pending';

-- Index for source filtering
CREATE INDEX idx_knowledge_gaps_source ON knowledge_gaps (source);

-- RLS: service role only (no public access)
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on knowledge_gaps"
  ON knowledge_gaps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ── web_conversations: chat transcripts ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS web_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]',
  -- messages shape: [{ "role": "user"|"assistant"|"system", "content": "...", "timestamp": "...", "type": "text"|"voice" }]
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- Index for looking up conversations by lead
CREATE INDEX idx_web_conversations_lead ON web_conversations (lead_id, started_at DESC);

-- RLS: service role only
ALTER TABLE web_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on web_conversations"
  ON web_conversations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
