-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260827070840 name=admission_partner_enums applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admission_partner';
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'admission_partner';
