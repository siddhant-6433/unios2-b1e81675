-- Grant table privileges to authenticated. RLS policies (in
-- 20260517100000_personal_documents.sql) enforce per-row access, but
-- without role-level grants the API caller can't reach the table at all
-- and gets "permission denied".
GRANT SELECT, UPDATE         ON public.personal_dashboard_users    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
                              ON public.personal_documents          TO authenticated;
GRANT SELECT                  ON public.personal_doc_reminders_sent TO authenticated;

-- Edge functions (and pg_cron via service-role bearer) authenticate as the
-- `service_role` Postgres role, NOT `postgres`. Without these grants the
-- admin client gets empty results / "permission denied" — RLS is bypassed
-- but role-level grants still apply.
GRANT ALL                     ON public.personal_dashboard_users    TO service_role;
GRANT ALL                     ON public.personal_documents          TO service_role;
GRANT ALL                     ON public.personal_doc_reminders_sent TO service_role;
