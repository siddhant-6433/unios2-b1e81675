-- Final two RLS-enabled tables missing authenticated grants. _app_config
-- is intentionally excluded — it holds the service_role_key and supabase_url
-- and should remain locked from authenticated callers (only service_role
-- and edge-function triggers via pg_net read it).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.counsellor_score_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counsellor_targets      TO authenticated;

-- Final audit
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
      AND t.tablename <> '_app_config'  -- intentionally locked
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public'
          AND g.table_name = t.tablename
          AND g.grantee = 'authenticated'
      )
    ORDER BY t.tablename
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'Still missing authenticated grant: %', r.tablename;
  END LOOP;
  IF cnt = 0 THEN
    RAISE NOTICE 'All RLS-enabled public tables (except _app_config) now have authenticated grants. Clean.';
  END IF;
END $$;
