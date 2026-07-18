-- Prep: move 9555192192 from Plivo BSP -> direct Meta Cloud API (native
-- Coexistence, so the number stays live on the WhatsApp Business App too).
--
-- This migration is SAFE TO APPLY ANYTIME: the new row is inserted is_active=false
-- and carries a placeholder phone_number_id, so it never participates in routing
-- until the cutover block at the bottom is run with real Meta credentials.
--
-- Inbound needs no code: whatsapp-webhook is number-agnostic (reads
-- metadata.phone_number_id / display_phone_number). Outbound is DB-driven via
-- whatsapp_channels + _shared/whatsapp-channel.ts, which reads the token from
-- secret_token_name and the id from meta_phone_number_id — hence config-only.

-- provider='meta' + route='plivo_admissions' keeps this the "second number"
-- route so it never ties with the primary admissions route in channel scoring;
-- it differs from the existing Plivo row only by provider, so no unique conflict.
insert into public.whatsapp_channels (
  label, provider, route, business_number, meta_phone_number_id,
  secret_token_name, is_active, allow_ai, allow_manual_reply, allow_bulk, quality_risk_level
) values (
  'Admissions Meta coexistence sender 9555192192',
  'meta',
  'plivo_admissions',
  '919555192192',
  'REPLACE_WITH_REAL_PHONE_NUMBER_ID',  -- fill at cutover
  'WHATSAPP_COEXIST_API_TOKEN',          -- create this Supabase secret at cutover
  false,                                  -- flip to true at cutover
  true, true, false, 'normal'
)
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- CUTOVER (run only after Meta onboarding — needs the real phone_number_id +
-- the WHATSAPP_COEXIST_API_TOKEN secret set in Supabase). Also flip the inbox
-- tab provider "plivo" -> "meta" for PLIVO_WHATSAPP_NUMBER in WhatsAppInbox.tsx
-- and add the real pnid to KNOWN_META_PHONE_NUMBER_ID_TO_NUMBER.
--
--   update public.whatsapp_channels
--   set meta_phone_number_id = '<REAL_PNID>', is_active = true
--   where provider = 'meta' and route = 'plivo_admissions'
--     and business_number = '919555192192';
--
--   update public.whatsapp_channels
--   set is_active = false
--   where provider = 'plivo' and route = 'plivo_admissions'
--     and business_number = '919555192192';
-- ─────────────────────────────────────────────────────────────────────────────
