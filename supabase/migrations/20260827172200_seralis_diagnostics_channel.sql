-- Second Seralis number: "Seralis Lab Diagnostics" (9599931471), under the same
-- Seralis business but a separate WABA (826723486551621); reuses the Seralis
-- system-user token (WHATSAPP_SERALIS_API_TOKEN). Idempotent.
INSERT INTO public.whatsapp_channels
  (label, provider, route, business_number, meta_phone_number_id, secret_token_name, waba_id, is_active, allow_bulk, quality_risk_level)
SELECT 'Seralis Lab Diagnostics sender 9599931471','meta','reply','919599931471','836776566178513','WHATSAPP_SERALIS_API_TOKEN','826723486551621', true, true, 'normal'
WHERE NOT EXISTS (
  SELECT 1 FROM public.whatsapp_channels WHERE meta_phone_number_id = '836776566178513'
);
