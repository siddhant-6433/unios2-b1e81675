-- keep-migration-version: already recorded on production schema_migrations
-- version=20260915081040 name=admission_head_call_log_visibility
-- Call Log / AI Call Log were empty for admission_head (and other staff with
-- call_log:view) because:
--   1. call_logs SELECT omitted principal and data_entry, who have the page
--      permission but no matching RLS branch.
--   2. ai_call_records had INSERT/UPDATE policies and no git-tracked SELECT
--      policy, so reads depended on dashboard-only grants that not every
--      admission role had.
-- Recreate both as cheap has_role checks. Counsellors stay scoped to their
-- own caller identity. Nested lead embeds are removed from the React pages;
-- those joins were running the expensive leads RLS after the call-log scan
-- and failing the whole request for org-wide roles.

GRANT SELECT ON public.call_logs TO authenticated;
GRANT SELECT ON public.ai_call_records TO authenticated;

DROP POLICY IF EXISTS "Staff can select call logs" ON public.call_logs;
CREATE POLICY "Staff can select call logs" ON public.call_logs
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Staff can select ai_call_records" ON public.ai_call_records;
CREATE POLICY "Staff can select ai_call_records" ON public.ai_call_records
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
  );
