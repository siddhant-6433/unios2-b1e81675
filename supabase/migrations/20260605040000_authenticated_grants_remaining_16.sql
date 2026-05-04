-- Cleanup of the 16 remaining RLS-enabled public tables that were
-- created without a GRANT to the authenticated role. Audit was logged
-- by 20260605030000.
--
-- Each of these tables has RLS policies that gate access by role —
-- granting the table-level access is safe because the RLS layer still
-- enforces the actual rules. Without these grants, any authenticated
-- request hits "permission denied for table X" before RLS even runs,
-- silently breaking the corresponding UI feature.
--
-- Granting the full DML set; restrict downstream via RLS as needed.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_drafts             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_attendance           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_records               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_checklists        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_otps              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_conversations          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_category_keywords       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_category_training       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_penalty_log          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_allocation_rules      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_followup_nudges      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_queries            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_gaps             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_responses         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_ad_spend            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_inactivity_thresholds TO authenticated;

-- Re-run the audit to confirm we're at zero
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
    RAISE NOTICE 'Still missing authenticated grant: %', r.tablename;
  END LOOP;
  IF cnt = 0 THEN
    RAISE NOTICE 'All RLS-enabled tables now have at least one grant to authenticated.';
  END IF;
END $$;
