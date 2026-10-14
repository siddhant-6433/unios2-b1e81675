-- keep-migration-version: restored production migration 20261012133107; preserve its applied version.
-- Verified against Meta's NIMT business account on 2026-10-12.
-- Re-registration changed Beacon's phone_number_id; the previous id fails 100/33.
UPDATE public.whatsapp_channels
SET meta_phone_number_id = '1391213820731999',
    waba_id = '2169878450547146',
    secret_token_name = 'WHATSAPP_API_TOKEN',
    updated_at = now()
WHERE provider = 'meta'
  AND business_number = '919599931443';
