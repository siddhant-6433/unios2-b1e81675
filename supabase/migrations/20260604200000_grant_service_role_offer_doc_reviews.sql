-- Followup to 20260604190000 — same fix for offer_letters + application_doc_reviews
-- which were also created with GRANT to authenticated only. Service role
-- needs explicit privileges to insert via PostgREST.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_letters           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_doc_reviews TO service_role;
