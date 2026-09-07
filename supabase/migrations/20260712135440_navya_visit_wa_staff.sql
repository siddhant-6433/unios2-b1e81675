-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712135440 name=navya_visit_wa_staff applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Staff WhatsApp recipients for Navya's visit-booked alerts
-- (navya_visit_alert template). The lead owner is always messaged; these
-- are the leadership phones added on every alert. Managed via _app_config
-- so recipients can change without a deploy.

INSERT INTO public._app_config (key, value)
VALUES (
  'navya_visit_wa_staff_recipients',
  '[{"name":"Kushal Chauhan","phone":"+919015091321"},{"name":"Ganesh Prasad","phone":"+919101074858"},{"name":"Jai Gopal Jindal","phone":"+917049984169"},{"name":"N. Nithya","phone":"+917736672183"},{"name":"Saiyed Faisal","phone":"+919910108405"}]'
)
ON CONFLICT (key) DO NOTHING;
