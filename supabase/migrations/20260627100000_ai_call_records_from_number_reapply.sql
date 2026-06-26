-- Re-apply the Cloud Call caller-ID audit column under a unique migration
-- version. The original 20260627003000 file collided with a library migration
-- version in production history, so Supabase treated it as already applied.
ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS from_number text;

COMMENT ON COLUMN public.ai_call_records.from_number IS
  'Normalized Plivo caller ID selected for this call. Manual Cloud Calls use this for durable dialer DID rotation and audit.';

CREATE INDEX IF NOT EXISTS idx_ai_call_records_manual_from_number_created
  ON public.ai_call_records (created_at DESC)
  WHERE call_type = 'manual' AND from_number IS NOT NULL;
