-- Persisted admission document-completeness on each application.
--
-- The required-document rules live in TypeScript (getRequiredDocs) and are the
-- single source of truth. The sync-admission-doc-status edge function computes
-- completeness there and writes it here so the SQL admission-number gate and the
-- "Pending AN Generation" inbox can read it without re-implementing doc rules.
--
--   mandatory_docs_complete : every MANDATORY required doc uploaded AND verified.
--   admission_doc_status    : full breakdown for the inbox card, shape:
--       { complete, required_total, verified, rejected, pending, missing,
--         docs: [ { key, label, state } ] }   state ∈ verified|rejected|pending|missing
--   admission_doc_status_at : when it was last recomputed.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS mandatory_docs_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admission_doc_status jsonb,
  ADD COLUMN IF NOT EXISTS admission_doc_status_at timestamptz;

-- Cheap lookup for the gate helper / inbox query (by lead).
CREATE INDEX IF NOT EXISTS idx_applications_mandatory_docs_complete
  ON public.applications (lead_id) WHERE mandatory_docs_complete = false;
