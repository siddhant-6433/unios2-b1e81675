-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260906090822 name=fee_refund_zoho_vendor applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS zoho_vendor_id text;
ALTER TABLE public.fee_refunds ADD COLUMN IF NOT EXISTS zoho_vendor_id text;
