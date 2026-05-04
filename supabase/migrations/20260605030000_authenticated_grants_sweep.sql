-- Comprehensive sweep of GRANT TO authenticated for every table I touched
-- in this admission-lifecycle work. Idempotent — GRANT is safe to re-run.
--
-- Surfaced repeatedly: tables created with RLS policies but no underlying
-- GRANT to the authenticated role. PostgreSQL rejects at the GRANT layer
-- before RLS even runs, so users hit "permission denied for table" with
-- no useful diagnostic. Running this fixes all the known cases at once.

-- Tables added in this session
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_doc_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_drafts             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_magic_tokens    TO authenticated;
-- ga_event_log is super_admin-read-only by RLS; only SELECT needed
GRANT SELECT                          ON public.ga_event_log           TO authenticated;

-- Existing tables that had the same omission (offer_letters surfaced via
-- "Issue Offer Letter" click; the others are pre-empted now)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_letters           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_payments           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_activities         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads                   TO authenticated;

-- Audit: list any remaining RLS-enabled public tables where authenticated
-- has zero privileges. Logged via NOTICE so the deploy log captures it.
DO $$
DECLARE
  r RECORD;
  cnt INT := 0;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.rowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public'
          AND g.table_name = t.tablename
          AND g.grantee = 'authenticated'
      )
    ORDER BY t.tablename
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'RLS-enabled table without any authenticated grant: %', r.tablename;
  END LOOP;
  IF cnt = 0 THEN
    RAISE NOTICE 'All RLS-enabled tables have at least one grant to authenticated — clean.';
  ELSE
    RAISE NOTICE '% table(s) still need attention (review NOTICE lines above).', cnt;
  END IF;
END $$;
