-- Authenticated staff couldn't UPSERT application_doc_reviews via PostgREST
-- (super_admin saw "permission denied for table application_doc_reviews"
-- when clicking Verify in the doc-review wizard).
--
-- Root cause: the table was created with RLS + a policy gating access by
-- has_role checks, but no table-level GRANT to the authenticated role.
-- Postgres rejects the operation at the GRANT layer before RLS even runs.
--
-- Same omission existed on lead_drafts (autosave from AddLeadDialog).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_doc_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_drafts             TO authenticated;
