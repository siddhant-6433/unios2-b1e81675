-- Two related changes bundled together (live-transfer popup + course video):
--
-- 1. Live-transfer marking on ai_call_records.
--    transfer_to_human_agent already exists in the voice-agent and
--    successfully bridges Plivo legs. What's missing: the counsellor's
--    UI doesn't know an incoming call is a "live transfer from AI" vs
--    a normal inbound. Adding two fields:
--       is_live_transfer  bool — true when AI redirected the call.
--       transfer_reason   text — the LLM-supplied "why" (e.g. "interested
--                                in BSc Nursing"). Surfaced in LiveCallBar
--                                so the counsellor walks into the call
--                                with context.
--
-- 2. courses.video_url — per-course YouTube/Vimeo link, included as a
--    button on the post-call WhatsApp template. NULL means no video and
--    the WA template falls back to the course-page URL.

ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS is_live_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_reason text;

CREATE INDEX IF NOT EXISTS idx_ai_call_records_live_transfer_active
  ON public.ai_call_records (created_at DESC)
  WHERE is_live_transfer = true AND status = 'initiated';

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.courses.video_url IS
  'Optional YouTube/Vimeo URL embedded as a "Watch Course Video" button on the post-call WhatsApp template (ai_call_post_summary). NULL → falls back to course page URL.';
