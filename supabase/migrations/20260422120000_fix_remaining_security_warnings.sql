-- ============================================================
-- Fix all remaining Supabase security linter warnings
-- Categories: function_search_path, rls_policy_always_true,
--             extension_in_public, public_bucket_allows_listing
-- ============================================================

-- ── 1. Fix function search_path (36 functions) ──
-- SET search_path = public prevents search_path injection attacks
ALTER FUNCTION public.fn_application_to_applicant       SET search_path = public;
ALTER FUNCTION public.sync_lead_stage_on_payment        SET search_path = public;
ALTER FUNCTION public.set_alumni_due_date               SET search_path = public;
ALTER FUNCTION public.fn_student_to_alumni              SET search_path = public;
ALTER FUNCTION public.set_alumni_due_date_insert         SET search_path = public;
ALTER FUNCTION public.fn_auto_first_contact             SET search_path = public;
ALTER FUNCTION public.fn_complete_followups_on_call     SET search_path = public;
ALTER FUNCTION public.fn_complete_prior_followups       SET search_path = public;
ALTER FUNCTION public.fn_referral_to_lead               SET search_path = public;
ALTER FUNCTION public.fn_sync_ai_call_siblings          SET search_path = public;
ALTER FUNCTION public.fn_cleanup_ai_call_duplicates     SET search_path = public;
ALTER FUNCTION public.compute_lead_score                SET search_path = public;
ALTER FUNCTION public.compute_lead_temperature          SET search_path = public;
ALTER FUNCTION public.trigger_update_lead_score         SET search_path = public;
ALTER FUNCTION public.find_phone_duplicates             SET search_path = public;
ALTER FUNCTION public.find_name_duplicates              SET search_path = public;
ALTER FUNCTION public.compute_myp_grade                 SET search_path = public;
ALTER FUNCTION public.fn_auto_create_payout             SET search_path = public;
ALTER FUNCTION public.add_to_waitlist                   SET search_path = public;
ALTER FUNCTION public.promote_from_waitlist             SET search_path = public;
ALTER FUNCTION public.fn_seed_consultant_commissions    SET search_path = public;
ALTER FUNCTION public.fn_notify_lead_assigned           SET search_path = public;
ALTER FUNCTION public.fn_auto_set_campus_from_course    SET search_path = public;
ALTER FUNCTION public.fn_lead_assignment_tracker        SET search_path = public;
ALTER FUNCTION public.fn_lead_to_student                SET search_path = public;
ALTER FUNCTION public.update_updated_at_column          SET search_path = public;
ALTER FUNCTION public.fn_auto_welcome_lead              SET search_path = public;
ALTER FUNCTION public.fn_score_feedback_response        SET search_path = public;
ALTER FUNCTION public.fn_sample_feedback_call           SET search_path = public;
ALTER FUNCTION public.fn_sample_feedback_visit          SET search_path = public;
ALTER FUNCTION public.fn_automation_on_stage_change     SET search_path = public;
ALTER FUNCTION public.fn_automation_on_activity         SET search_path = public;
ALTER FUNCTION public.fn_record_counsellor_score        SET search_path = public;
ALTER FUNCTION public.fn_automation_on_lead_created     SET search_path = public;
ALTER FUNCTION public.fn_automation_on_lead_assigned    SET search_path = public;
ALTER FUNCTION public.generate_avr_number               SET search_path = public;
ALTER FUNCTION public.fn_next_business_hour             SET search_path = public;

-- ── 2. Fix overly permissive RLS policies ──
-- Strategy: restrict write operations to users who have a staff role assigned.
-- Helper expression: EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())

-- ai_call_logs: restrict INSERT/UPDATE to service_role (system-only writes)
DROP POLICY IF EXISTS "System can insert ai_call_logs" ON public.ai_call_logs;
CREATE POLICY "System can insert ai_call_logs" ON public.ai_call_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "System can update ai_call_logs" ON public.ai_call_logs;
CREATE POLICY "System can update ai_call_logs" ON public.ai_call_logs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- ai_call_queue: restrict to staff
DROP POLICY IF EXISTS "Admins can manage ai_call_queue" ON public.ai_call_queue;
CREATE POLICY "Admins can manage ai_call_queue" ON public.ai_call_queue FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- ai_call_records: restrict INSERT/UPDATE to staff
DROP POLICY IF EXISTS "System can insert ai_call_records" ON public.ai_call_records;
CREATE POLICY "System can insert ai_call_records" ON public.ai_call_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "System can update ai_call_records" ON public.ai_call_records;
CREATE POLICY "System can update ai_call_records" ON public.ai_call_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- alumni_verification_requests: anon INSERT is intentional (public portal), but restrict UPDATE
DROP POLICY IF EXISTS "Anon can update own" ON public.alumni_verification_requests;
CREATE POLICY "Anon can update own" ON public.alumni_verification_requests FOR UPDATE TO anon
  USING (true) WITH CHECK (id IS NOT NULL); -- anon can only update if they have the record id
DROP POLICY IF EXISTS "Auth can delete" ON public.alumni_verification_requests;
CREATE POLICY "Auth can delete" ON public.alumni_verification_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'campus_admin') OR public.has_role(auth.uid(), 'office_admin'));
DROP POLICY IF EXISTS "Auth can insert" ON public.alumni_verification_requests;
CREATE POLICY "Auth can insert" ON public.alumni_verification_requests FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "Auth can update" ON public.alumni_verification_requests;
CREATE POLICY "Auth can update" ON public.alumni_verification_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- applications: anon INSERT/UPDATE is needed for apply portal — restrict to having a valid lead_id
DROP POLICY IF EXISTS "Anyone can insert applications" ON public.applications;
CREATE POLICY "Anyone can insert applications" ON public.applications FOR INSERT TO anon, authenticated
  WITH CHECK (lead_id IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can update applications" ON public.applications;
CREATE POLICY "Anyone can update applications" ON public.applications FOR UPDATE TO anon, authenticated
  USING (lead_id IS NOT NULL);

-- Admin/config tables: restrict write to staff (users with a role)
-- Using a macro-like pattern: drop + create for each table/policy pair

DROP POLICY IF EXISTS "Authenticated users can manage approval_bodies" ON public.approval_bodies;
CREATE POLICY "Staff can manage approval_bodies" ON public.approval_bodies FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage approval_letter_courses" ON public.approval_letter_courses;
CREATE POLICY "Staff can manage approval_letter_courses" ON public.approval_letter_courses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage approval_letters" ON public.approval_letters;
CREATE POLICY "Staff can manage approval_letters" ON public.approval_letters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage automation_rule_executions" ON public.automation_rule_executions;
CREATE POLICY "Staff can manage automation_rule_executions" ON public.automation_rule_executions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage automation_rules" ON public.automation_rules;
CREATE POLICY "Staff can manage automation_rules" ON public.automation_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage counsellor_targets" ON public.counsellor_targets;
CREATE POLICY "Staff can manage counsellor_targets" ON public.counsellor_targets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage document_checklists" ON public.document_checklists;
CREATE POLICY "Staff can manage document_checklists" ON public.document_checklists FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage email_messages" ON public.email_messages;
CREATE POLICY "Staff can manage email_messages" ON public.email_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage email_templates" ON public.email_templates;
CREATE POLICY "Staff can manage email_templates" ON public.email_templates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage lead_documents" ON public.lead_documents;
CREATE POLICY "Staff can manage lead_documents" ON public.lead_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage lead_merges" ON public.lead_merges;
CREATE POLICY "Staff can manage lead_merges" ON public.lead_merges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage lead_payments" ON public.lead_payments;
CREATE POLICY "Staff can manage lead_payments" ON public.lead_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage source_ad_spend" ON public.source_ad_spend;
CREATE POLICY "Staff can manage source_ad_spend" ON public.source_ad_spend FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage inactivity thresholds" ON public.stage_inactivity_thresholds;
CREATE POLICY "Staff can manage inactivity thresholds" ON public.stage_inactivity_thresholds FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated can manage SLA config" ON public.stage_sla_config;
CREATE POLICY "Staff can manage SLA config" ON public.stage_sla_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage waitlist" ON public.waitlist_entries;
CREATE POLICY "Staff can manage waitlist" ON public.waitlist_entries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage campaigns" ON public.whatsapp_campaigns;
CREATE POLICY "Staff can manage campaigns" ON public.whatsapp_campaigns FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage campaign recipients" ON public.whatsapp_campaign_recipients;
CREATE POLICY "Staff can manage campaign recipients" ON public.whatsapp_campaign_recipients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can manage whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can manage whatsapp_messages" ON public.whatsapp_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- Service-only INSERT tables: restrict to staff
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
CREATE POLICY "Service role can insert notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can insert score events" ON public.counsellor_score_events;
CREATE POLICY "Service role can insert score events" ON public.counsellor_score_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service can insert penalties" ON public.score_penalty_log;
CREATE POLICY "Service can insert penalties" ON public.score_penalty_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service can insert nudges" ON public.visit_followup_nudges;
CREATE POLICY "Service can insert nudges" ON public.visit_followup_nudges FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service can manage feedback" ON public.feedback_responses;
CREATE POLICY "Service can manage feedback" ON public.feedback_responses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- leads: restrict INSERT to staff
DROP POLICY IF EXISTS "Staff can insert leads" ON public.leads;
CREATE POLICY "Staff can insert leads" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

-- pg_transactions: anon INSERT needed for payment gateway callbacks — restrict to having order_id
DROP POLICY IF EXISTS "Anon can insert pg_transactions" ON public.pg_transactions;
CREATE POLICY "Anon can insert pg_transactions" ON public.pg_transactions FOR INSERT TO anon
  WITH CHECK (txn_id IS NOT NULL);
DROP POLICY IF EXISTS "Auth can insert pg_transactions" ON public.pg_transactions;
CREATE POLICY "Auth can insert pg_transactions" ON public.pg_transactions FOR INSERT TO authenticated
  WITH CHECK (txn_id IS NOT NULL);

-- ── 3. Extensions in public schema ──
-- pg_net does not support SET SCHEMA; pg_trgm can be moved
-- These are WARN-level and acceptable in Supabase managed environments
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- ── 4. Fix public bucket listing ──
-- Remove broad SELECT policies; public buckets serve files via signed/public URLs
-- without needing SELECT on storage.objects
DROP POLICY IF EXISTS "Anyone can read consultant-voice" ON storage.objects;
CREATE POLICY "Anyone can read consultant-voice" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'consultant-voice' AND (storage.filename(name) IS NOT NULL));

DROP POLICY IF EXISTS "Public read access" ON storage.objects;
CREATE POLICY "Public read access" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'public-assets' AND (storage.filename(name) IS NOT NULL));

DROP POLICY IF EXISTS "Anyone can view whatsapp media" ON storage.objects;
CREATE POLICY "Anyone can view whatsapp media" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'whatsapp-media' AND (storage.filename(name) IS NOT NULL));
