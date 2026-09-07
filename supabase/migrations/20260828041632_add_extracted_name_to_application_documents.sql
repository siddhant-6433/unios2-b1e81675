-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260828041632 name=add_extracted_name_to_application_documents applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.application_documents
  ADD COLUMN IF NOT EXISTS extracted_name text;
