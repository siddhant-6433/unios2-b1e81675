-- Lock anon out of storage.objects for application-documents.
--
-- This is the follow-up to the 2026-05-16 hotfix
-- (20260516170000_restore_anon_application_docs_upload.sql) which re-opened
-- broad anon access so the apply portal could function. With the
-- `apply-portal-upload-doc` edge function in place (service-role uploads,
-- gated by application_id + phone match), anonymous clients no longer need
-- direct write access to the bucket.
--
-- DO NOT APPLY this migration until the client deployment that switches
-- `DocumentUpload.tsx` and `PhotoUpload.tsx` to the edge function is live.
-- Otherwise applicants get blocked again with the same RLS error.
--
-- After this migration:
--   - anon: no INSERT / UPDATE / SELECT on storage.objects for this bucket.
--     Public-URL downloads still work because the bucket itself is public.
--   - authenticated (staff): SELECT + UPDATE retained via existing policies.
--   - service_role (edge function): unrestricted (bypasses RLS).

DROP POLICY IF EXISTS "Anyone can upload application docs" ON storage.objects;
DROP POLICY IF EXISTS "Anon upload application-documents" ON storage.objects;
DROP POLICY IF EXISTS "Anon read application-documents"   ON storage.objects;
DROP POLICY IF EXISTS "Anon update application-documents" ON storage.objects;

-- Authenticated INSERT remains so staff (admissions, counsellors) can still
-- upload via the admin UI on behalf of applicants.
DROP POLICY IF EXISTS "Auth upload application-documents" ON storage.objects;
CREATE POLICY "Auth upload application-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'application-documents');

-- "Auth update application-documents" and "Auth read application-documents"
-- already exist from prior migrations — leave them in place.
