-- Move 9555192192 from Plivo BSP -> direct Meta Cloud API (native Coexistence,
-- so the number stays live on the WhatsApp Business App too).
--
-- Inbound needs no code: whatsapp-webhook is number-agnostic (reads
-- metadata.phone_number_id / display_phone_number). Outbound is DB-driven via
-- whatsapp_channels + _shared/whatsapp-channel.ts, which reads the token from
-- secret_token_name and the id from meta_phone_number_id. Send routing keys off
-- the conversation's stored provider + phone_number_id, so once inbound arrives
-- via Meta it replies via Meta automatically using this row's token.
--
-- Token is the shared WHATSAPP_API_TOKEN (same as the other Meta numbers).
-- phone_number_id 1216095224919854 supplied by Meta for 9555192192.
--
-- provider='meta' + route='plivo_admissions' keeps this the "second number"
-- route so it never ties with the primary admissions route in channel scoring;
-- it differs from the existing Plivo row only by provider (no unique conflict),
-- and both can stay active during the transition (routing keys on conv.provider).
insert into public.whatsapp_channels (
  label, provider, route, business_number, meta_phone_number_id,
  secret_token_name, is_active, allow_ai, allow_manual_reply, allow_bulk, quality_risk_level
) values (
  'Admissions Meta coexistence sender 9555192192',
  'meta',
  'plivo_admissions',
  '919555192192',
  '1216095224919854',
  'WHATSAPP_API_TOKEN',
  true,
  true, true, false, 'normal'
)
on conflict do nothing;

-- Plivo row is left active during transition so existing plivo-provider
-- conversations keep replying until they age out. Once all 9555 traffic arrives
-- via Meta, deactivate it:
--   update public.whatsapp_channels set is_active = false
--   where provider = 'plivo' and route = 'plivo_admissions'
--     and business_number = '919555192192';
