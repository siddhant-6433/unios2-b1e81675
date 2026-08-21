-- Two new WhatsApp numbers on the same Meta app, as school-scoped senders:
--   9599931443 -> NIMT Beacon School Avantika II (phone_number_id 1274023025796842)
--   9220522282 -> Mirai Experiential School     (phone_number_id 1110238142172240)
--
-- Inbound needs no code: whatsapp-webhook is number-agnostic. These rows make
-- OUTBOUND / inbound-reply sends resolve a Meta sender via _shared/whatsapp-channel.ts
-- (token from secret_token_name, id from meta_phone_number_id). Send routing keys
-- off the conversation's stored provider + phone_number_id, so replies go back out
-- the number they arrived on once a channel row matches.
--
-- route='reply' keeps these off the primary admissions route in channel scoring.
-- Token is the shared WHATSAPP_API_TOKEN (same as the other Meta numbers).
-- The AI reply itself is school-scoped in whatsapp-ai-reply/index.ts (SCHOOL_CHANNELS,
-- keyed by these phone_number_ids) so they never get the NIMT college menu/KB.
insert into public.whatsapp_channels (
  label, provider, route, business_number, meta_phone_number_id,
  secret_token_name, is_active, allow_ai, allow_manual_reply, allow_bulk, quality_risk_level
) values
  (
    'NIMT Beacon School Avantika II sender 9599931443',
    'meta', 'reply', '919599931443', '1274023025796842',
    'WHATSAPP_API_TOKEN', true, true, true, false, 'normal'
  ),
  (
    'Mirai Experiential School sender 9220522282',
    'meta', 'reply', '919220522282', '1110238142172240',
    'WHATSAPP_API_TOKEN', true, true, true, false, 'normal'
  )
on conflict do nothing;
