-- Add missing disposition columns to ai_call_logs
-- The voice agent tries to write these but they silently fail because the columns don't exist

ALTER TABLE public.ai_call_logs
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS disposition_notes text,
  ADD COLUMN IF NOT EXISTS followup_scheduled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visit_scheduled boolean DEFAULT false;

COMMENT ON COLUMN public.ai_call_logs.disposition IS 'interested, not_interested, ineligible, call_back, wrong_number, do_not_contact, voicemail, busy';
