-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260818112517 name=wa_school_numbers_beacon_mirai applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
