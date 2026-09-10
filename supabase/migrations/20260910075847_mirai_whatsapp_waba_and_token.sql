-- Mirai 9220522282 is connected in WhatsApp Manager on its own Meta business
-- ("Mirai Experiential School", business 515556675506273, WABA 34722980423984295,
-- Cloud API phone number id 1110238142172240). It was stored on NIMT's
-- WHATSAPP_API_TOKEN, so Graph returns 133010 (not registered on that app).
-- Same pattern as Seralis: dedicated system-user token in an edge secret.
-- The token itself is WHATSAPP_MIRAI_API_TOKEN — not stored here.
UPDATE public.whatsapp_channels
SET
  waba_id = '34722980423984295',
  secret_token_name = 'WHATSAPP_MIRAI_API_TOKEN'
WHERE meta_phone_number_id = '1110238142172240'
   OR business_number IN ('919220522282', '9220522282');
