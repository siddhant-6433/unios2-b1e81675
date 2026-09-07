-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260822041128 name=grant_fee_notification_campaigns applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

grant select, insert, update, delete on public.fee_notification_campaigns to authenticated;
grant all on public.fee_notification_campaigns to service_role;
