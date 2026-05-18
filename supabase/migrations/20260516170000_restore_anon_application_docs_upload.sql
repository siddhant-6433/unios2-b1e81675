-- HOTFIX: restore anon upload on application-documents.
--
-- The 2026-06-10 storage hardening migration dropped SELECT + UPDATE policies
-- for anon on application-documents, leaving only INSERT. The apply portal is
-- session-less for applicants (anon role) and uploads documents with
-- `upsert: true`. Postgres translates that to INSERT ... ON CONFLICT DO UPDATE,
-- which requires the UPDATE policy (for the update path) and the SELECT policy
-- (to check the existing-row's RLS visibility for conflict detection). Without
-- those, every applicant upload fails with "new row violates row-level security
-- policy", regardless of whether a prior file existed.
--
-- Storage logs confirmed broad breakage (APP-26-KF30, APP-26-L9GH, APP-26-2G3D,
-- APP-26-FT3B all returning 400 on every doc-upload POST, including
-- passport_photo.png).
--
-- Restoring the anon SELECT/UPDATE for this bucket re-introduces the
-- enumeration + overwrite exposure flagged by the security advisor. That is
-- accepted as a temporary trade-off: applicants are completely blocked from
-- submitting documents otherwise. Follow-up work should move document upload
-- through a SECURITY DEFINER edge function (mirroring the apply-portal lookup
-- RPC) so anon never touches storage.objects directly. Tracked in
-- docs/admission-flow-audit.md.

CREATE POLICY "Anon read application-documents"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'application-documents');

CREATE POLICY "Anon update application-documents"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'application-documents')
  WITH CHECK (bucket_id = 'application-documents');

-- Also re-add authenticated SELECT in case applicants get a session in the
-- future (the existing "Auth update application-documents" already covers UPDATE).
CREATE POLICY "Auth read application-documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'application-documents');
