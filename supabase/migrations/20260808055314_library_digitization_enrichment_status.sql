-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260808055314 name=library_digitization_enrichment_status applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.library_digitization_records
  ADD COLUMN IF NOT EXISTS enrichment_status text;
