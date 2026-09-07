-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260821074607 name=add_hr_executive_role applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_executive';
