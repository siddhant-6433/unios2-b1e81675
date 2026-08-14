-- The applicant portal (uni.nimt.ac.in) runs as the anon role (WhatsApp-OTP
-- auth, no Supabase session). When a candidate submits an ABVMU deposit claim,
-- TokenFeePanel uploads the challan straight to the `application-documents`
-- storage bucket before calling submit_abvmu_deposit_claim().
--
-- That bucket only had `authenticated` policies, so the anon upload failed with
-- "new row violates row-level security policy for table objects" and the whole
-- token-fee panel was replaced by that raw error.
--
-- Grant anon INSERT, scoped tightly to the `abvmu-claims/` prefix so this does
-- not open the rest of the bucket to anonymous writes. Reads stay server-side
-- via the SECURITY DEFINER RPC, so no anon SELECT is needed here.

drop policy if exists "Anon insert abvmu-claims application-documents" on storage.objects;

create policy "Anon insert abvmu-claims application-documents"
on storage.objects for insert to anon
with check (
  bucket_id = 'application-documents'
  and name like 'abvmu-claims/%'
);
