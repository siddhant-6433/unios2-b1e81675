-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260810105812 name=applications_admission_doc_status applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS mandatory_docs_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admission_doc_status jsonb,
  ADD COLUMN IF NOT EXISTS admission_doc_status_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_mandatory_docs_complete
  ON public.applications (lead_id) WHERE mandatory_docs_complete = false;
