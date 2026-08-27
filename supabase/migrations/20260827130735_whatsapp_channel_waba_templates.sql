-- Per-number template availability for the marketing sender picker.
--
-- Each coexistence number is its own WABA, and WhatsApp templates are per-WABA:
-- a template approved under the main WABA cannot be sent from a number under a
-- different WABA (Meta 132001 "Template does not exist"). To stop the picker
-- offering a number that can't send the chosen template, store each channel's
-- WABA id and the set of APPROVED template names in that WABA (synced by
-- whatsapp-channel-profiles-sync). available_templates NULL = not yet synced
-- (WABA unknown) → the UI treats it as "unverified" rather than blocking.

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS waba_id             text,
  ADD COLUMN IF NOT EXISTS available_templates text[],
  ADD COLUMN IF NOT EXISTS templates_synced_at timestamptz;

-- Known WABA: 9555192192 (phone-id 1216095224919854) lives under 963503789849531.
UPDATE public.whatsapp_channels
   SET waba_id = '963503789849531'
 WHERE meta_phone_number_id = '1216095224919854' AND waba_id IS NULL;
