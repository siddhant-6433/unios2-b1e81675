-- WhatsApp AI Reply Quality Overhaul
-- Adds implicit feedback tracking, keyword matching, topic state, and FTS indexes

-- ── ai_feedback column on whatsapp_messages for implicit feedback ──────────
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS ai_feedback text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_ai_feedback
  ON public.whatsapp_messages (ai_feedback)
  WHERE ai_feedback IS NOT NULL;

-- ── keywords column on admissions_ai_reply_examples for keyword-boosted matching ──
ALTER TABLE public.admissions_ai_reply_examples
  ADD COLUMN IF NOT EXISTS keywords text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_admissions_ai_reply_examples_keywords
  ON public.admissions_ai_reply_examples USING gin(keywords);

-- ── FTS indexes for golden answer and knowledge gap text search ────────────
CREATE INDEX IF NOT EXISTS idx_admissions_ai_reply_examples_query_fts
  ON public.admissions_ai_reply_examples USING gin(to_tsvector('english', query_text))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_query_fts
  ON public.knowledge_gaps USING gin(to_tsvector('english', query_text));

-- ── Topic state persistence on conversation state ─────────────────────────
ALTER TABLE public.whatsapp_conversation_state
  ADD COLUMN IF NOT EXISTS last_ai_topic text,
  ADD COLUMN IF NOT EXISTS last_ai_course text;
