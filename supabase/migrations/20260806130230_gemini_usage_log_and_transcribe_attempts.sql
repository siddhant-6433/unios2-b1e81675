-- gemini usage log and transcribe attempts
--
-- Gemini cost control: per-call token attribution + a transcription failure cutoff.

-- ── 1. Token attribution ──────────────────────────────────────────────────
-- Every generateContent response returns usageMetadata for free. Nothing read
-- it, so per-function spend was unknowable. One narrow append-only table.
CREATE TABLE IF NOT EXISTS public.gemini_usage_log (
  id             bigserial PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  source         text        NOT NULL,
  model          text        NOT NULL,
  prompt_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens  integer     NOT NULL DEFAULT 0,
  thought_tokens integer     NOT NULL DEFAULT 0,
  total_tokens   integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS gemini_usage_log_created_source_idx
  ON public.gemini_usage_log (created_at DESC, source);

ALTER TABLE public.gemini_usage_log ENABLE ROW LEVEL SECURITY;

-- Edge functions write with the service role, which bypasses RLS — but the
-- GRANT is still required (see the academic_partners incident: a missing
-- service_role GRANT reads as an RLS problem and wastes a day).
GRANT SELECT, INSERT ON public.gemini_usage_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.gemini_usage_log_id_seq TO service_role;

-- Read-only for super admins so spend can be queried directly.
DROP POLICY IF EXISTS gemini_usage_log_admin_read ON public.gemini_usage_log;
CREATE POLICY gemini_usage_log_admin_read ON public.gemini_usage_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- ── 2. Transcription failure cutoff ───────────────────────────────────────
-- voice-call-callback re-picks `summary IS NULL` every 5 minutes with no
-- attempt counter. Records whose audio Gemini cannot process were being
-- re-downloaded and re-billed forever (94 stuck, oldest 2026-07-31).
ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS transcribe_attempts integer NOT NULL DEFAULT 0;

-- Retire the existing stuck backlog so the loop starts clean rather than
-- re-billing 94 known-bad recordings on the next deploy.
UPDATE public.ai_call_records
   SET transcribe_attempts = 3
 WHERE summary IS NULL
   AND status = 'completed'
   AND recording_url IS NOT NULL
   AND created_at < now() - interval '1 day';

-- Partial index matching the scan's predicate.
CREATE INDEX IF NOT EXISTS ai_call_records_untranscribed_idx
  ON public.ai_call_records (created_at DESC)
  WHERE summary IS NULL AND recording_url IS NOT NULL;
