-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260725044311 name=add_school_coordinator_enum applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'school_coordinator';
