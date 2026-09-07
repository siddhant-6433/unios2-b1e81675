-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260814095447 name=anon_insert_abvmu_claims_storage applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

drop policy if exists "Anon insert abvmu-claims application-documents" on storage.objects;

create policy "Anon insert abvmu-claims application-documents"
on storage.objects for insert to anon
with check (
  bucket_id = 'application-documents'
  and name like 'abvmu-claims/%'
);
