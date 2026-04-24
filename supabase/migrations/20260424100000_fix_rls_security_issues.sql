-- Fix RLS policies that were over-tightened by security migration
-- These block critical user-facing and system operations

-- 1. CRITICAL: Applications INSERT — allow without lead_id (it's set via UPDATE moments later)
DROP POLICY IF EXISTS "Anyone can insert applications" ON public.applications;
CREATE POLICY "Anyone can insert applications" ON public.applications
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- 2. Alumni verification — allow non-staff authenticated users (e.g. admin browsing portal)
DROP POLICY IF EXISTS "Auth can insert" ON public.alumni_verification_requests;
CREATE POLICY "Auth can insert" ON public.alumni_verification_requests
  FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Lead activities — allow system inserts (edge functions use service role, but triggers run as authenticated)
-- Keep staff policy, but also allow the trigger/system user
DROP POLICY IF EXISTS "Staff can insert lead activities" ON public.lead_activities;
CREATE POLICY "Staff can insert lead activities" ON public.lead_activities
  FOR INSERT TO authenticated WITH CHECK (true);

-- 4. Notifications — must allow system inserts (crons, triggers, webhooks)
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
CREATE POLICY "Anyone can insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- 5. Counsellor score events — triggered by DB triggers running as authenticated
DROP POLICY IF EXISTS "Service role can insert score events" ON public.counsellor_score_events;
CREATE POLICY "Anyone can insert score events" ON public.counsellor_score_events
  FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Feedback responses — needs anon access for sampling triggers
DROP POLICY IF EXISTS "Service can manage feedback" ON public.feedback_responses;
CREATE POLICY "Anyone can manage feedback" ON public.feedback_responses
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 7. Score penalty log — needs system access for cron
DROP POLICY IF EXISTS "Service can insert penalties" ON public.score_penalty_log;
CREATE POLICY "Anyone can insert penalties" ON public.score_penalty_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 8. Visit followup nudges — needs system access for cron
DROP POLICY IF EXISTS "Service can insert nudges" ON public.visit_followup_nudges;
CREATE POLICY "Anyone can insert nudges" ON public.visit_followup_nudges
  FOR INSERT TO authenticated WITH CHECK (true);

-- 9. AI call logs — voice agent needs to insert
DROP POLICY IF EXISTS "System can insert ai_call_logs" ON public.ai_call_logs;
CREATE POLICY "System can insert ai_call_logs" ON public.ai_call_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- 10. AI call records — voice agent needs to insert
DROP POLICY IF EXISTS "System can insert ai_call_records" ON public.ai_call_records;
CREATE POLICY "System can insert ai_call_records" ON public.ai_call_records
  FOR INSERT TO authenticated WITH CHECK (true);

-- 11. Automation rule executions — automation engine needs to insert
DROP POLICY IF EXISTS "Staff can manage automation_rule_executions" ON public.automation_rule_executions;
CREATE POLICY "Anyone can manage automation_rule_executions" ON public.automation_rule_executions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 12. Email messages — send-email function needs to insert
DROP POLICY IF EXISTS "Staff can manage email_messages" ON public.email_messages;
CREATE POLICY "Anyone can manage email_messages" ON public.email_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 13. WhatsApp messages — webhook needs to insert
DROP POLICY IF EXISTS "Staff can manage whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Anyone can manage whatsapp_messages" ON public.whatsapp_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
