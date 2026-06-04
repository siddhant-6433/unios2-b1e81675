-- Tighten call_logs RLS for counsellor logins.
--
-- Before: the single "Staff can manage call logs" FOR ALL policy allowed every
-- counsellor to SELECT every call_logs row. The /call-log page tried to scope
-- counsellors in React, but role loading is async, so a counsellor could briefly
-- render all callers' data when the first query ran before role resolution.
--
-- After: broad access is limited to admin admission roles. Counsellors can read
-- and mutate only rows where call_logs.user_id is their auth uid. Service-role
-- edge functions bypass RLS as before.

DROP POLICY IF EXISTS "Staff can manage call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Staff can select call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Staff can insert call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Staff can update call logs" ON public.call_logs;
DROP POLICY IF EXISTS "Super admin can delete call_logs" ON public.call_logs;

CREATE POLICY "Staff can select call logs" ON public.call_logs
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Staff can insert call logs" ON public.call_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Staff can update call logs" ON public.call_logs
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Super admin can delete call_logs" ON public.call_logs
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));
