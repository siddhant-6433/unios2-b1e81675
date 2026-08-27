-- Seralis Lab WhatsApp sender (9220522281), a separate Meta Business
-- ("Seralis Lab Diagnostics LLP") with its own WABA + token. Idempotent insert;
-- the token lives in the WHATSAPP_SERALIS_API_TOKEN edge secret, not here.
INSERT INTO public.whatsapp_channels
  (label, provider, route, business_number, meta_phone_number_id, secret_token_name, waba_id, is_active, allow_bulk, quality_risk_level)
SELECT 'Seralis Lab sender 9220522281','meta','reply','919220522281','762544046936970','WHATSAPP_SERALIS_API_TOKEN','1303502464451428', true, true, 'normal'
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_channels WHERE meta_phone_number_id = '762544046936970'
);
