-- Mirai 9220522282 is a separate WhatsApp account (WABA 34722980423984295)
-- under the same NIMT Meta org. It stays on WHATSAPP_API_TOKEN (same as Beacon
-- and the college numbers). We never stored this WABA id, so Graph 133010s
-- until the existing system user is assigned to this WhatsApp account and we
-- send against the right phone number id.
UPDATE public.whatsapp_channels
SET waba_id = '34722980423984295'
WHERE meta_phone_number_id = '1110238142172240'
   OR business_number IN ('919220522282', '9220522282');
