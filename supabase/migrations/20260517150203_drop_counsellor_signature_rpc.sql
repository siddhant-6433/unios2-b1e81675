-- The counsellor signature (name + phone) for nimt_followup_v1 is now
-- resolved inside the whatsapp-send edge function so the Plivo cloud-dialer
-- DID can come from the PLIVO_DIALER_PHONE_NUMBER env var (rotatable via
-- Supabase Functions secrets, no SQL state). Drop the SQL resolver so we
-- don't have two sources of truth for the fallback chain.
--
-- profiles.official_phone stays — still the highest-priority signal, just
-- read directly from the edge function via a profiles join now.

DROP FUNCTION IF EXISTS public.fn_resolve_counsellor_signature(uuid);
