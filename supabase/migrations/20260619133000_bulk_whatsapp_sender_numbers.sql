-- Surface all approved outgoing WhatsApp sender numbers in the bulk campaign picker.
-- Env-backed Meta routes still resolve their phone-number IDs from secrets at send time;
-- business_number is the operator-facing display/sender key.

update public.whatsapp_channels
set
  business_number = '919667641872',
  allow_bulk = true,
  label = 'Admissions Meta sender 9667641872',
  quality_risk_level = coalesce(quality_risk_level, 'normal')
where provider = 'meta'
  and route = 'admissions';

update public.whatsapp_channels
set
  business_number = '917428499849',
  allow_bulk = true,
  label = 'Bulk campaign Meta sender 7428499849',
  quality_risk_level = coalesce(quality_risk_level, 'watch')
where provider = 'meta'
  and route = 'bulk';

update public.whatsapp_channels
set
  allow_bulk = true,
  label = 'Admissions Plivo sender 9555192192',
  quality_risk_level = coalesce(quality_risk_level, 'normal')
where provider = 'plivo'
  and route = 'plivo_admissions'
  and business_number = '919555192192';
