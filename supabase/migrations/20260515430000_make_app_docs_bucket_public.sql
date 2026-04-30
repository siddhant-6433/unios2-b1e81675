-- Mark application-documents bucket as public so getPublicUrl()
-- returns URLs that resolve for anonymous users — required for
-- receipt PDFs / offer letters / branding images sent via email
-- and WhatsApp, where the recipient has no Supabase session.
--
-- Path-level guessability is acceptable here: every key contains a
-- UUID lead_id or offer_id, so enumeration is infeasible. Sensitive
-- documents (transcripts, identity proofs) live elsewhere if needed.
UPDATE storage.buckets SET public = true WHERE id = 'application-documents';
