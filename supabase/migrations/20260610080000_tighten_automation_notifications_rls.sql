-- Tighten automation_rule_executions + notifications RLS.
--
-- automation_rule_executions prior state:
--   "Anyone can manage automation_rule_executions" ALL {auth} qual=true
--   "Super admin can delete automation_rule_executions" DELETE — scoped
-- Every authenticated user could read AND mutate the entire automation
-- execution history. Frontend only SELECTs from src/pages/AutomationRules.tsx
-- (gated by automation:view permission). Backend INSERT runs from the
-- automation-engine edge function via service_role.
--
-- notifications prior state:
--   "Anyone can insert notifications" INSERT {auth} with_check=true
-- Any authenticated user could fabricate notifications targeting any other
-- user (notification spam). Backend INSERT runs from cron edge functions
-- via service_role. The existing SELECT/UPDATE/DELETE "own user" policies
-- remain unchanged.

DROP POLICY IF EXISTS "Anyone can manage automation_rule_executions" ON public.automation_rule_executions;

CREATE POLICY "Staff read automation_rule_executions"
  ON public.automation_rule_executions FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;
-- No replacement INSERT policy: all production INSERT paths use service_role.
-- If a future feature needs authenticated INSERT, add a scoped policy that
-- forces with_check (user_id = auth.uid()).
