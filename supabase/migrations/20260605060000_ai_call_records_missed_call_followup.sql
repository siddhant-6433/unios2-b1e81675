-- Missed-call follow-up flags on ai_call_records.
--
-- Set by the voice-agent /answer/inbound handler when an inbound call
-- arrives outside business hours (9 AM-8 PM IST, Mon-Sat) — the
-- counsellor isn't around to take it, so the call goes to the AI agent
-- and the record is flagged so a human can call the lead back the
-- next business morning.
--
-- The MissedCalls UI queries for needs_followup=true AND
-- followup_done_at IS NULL, ordered by created_at DESC.

ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS needs_followup    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_reason   text,
  ADD COLUMN IF NOT EXISTS followup_done_at  timestamptz,
  ADD COLUMN IF NOT EXISTS followup_done_by  uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_ai_call_records_pending_followup
  ON public.ai_call_records (created_at DESC)
  WHERE needs_followup = true AND followup_done_at IS NULL;

COMMENT ON COLUMN public.ai_call_records.needs_followup IS
  'TRUE when an inbound call landed outside business hours and a counsellor should call the lead back. Cleared by setting followup_done_at.';
