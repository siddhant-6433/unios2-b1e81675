-- Disk IO mitigation: wrap auth.uid() in (SELECT auth.uid()) inside every
-- RLS policy on the hot tables. This is a PURE PERFORMANCE rewrite — Postgres
-- evaluates a subquery once per statement as an InitPlan instead of once per
-- row. NO POLICY LOGIC IS CHANGED: same roles, same conditions, same rows
-- visible to the same users (counsellor / applicant / alumni / publisher /
-- consultant / staff). See:
--   https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Tables covered (top contributors from pg_stat_user_tables): leads,
-- lead_activities, lead_followups, lead_notes, whatsapp_messages,
-- ai_call_records, applications, call_logs, profiles, user_roles, teams,
-- departments.
--
-- Each policy is dropped and recreated with identical USING / WITH CHECK,
-- except every bare `auth.uid()` is replaced with `(SELECT auth.uid())`.

-- =============================================================================
-- leads
-- =============================================================================

DROP POLICY IF EXISTS "Consultants can insert leads" ON public.leads;
CREATE POLICY "Consultants can insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'consultant'::app_role)
    AND (consultant_id IN (
      SELECT consultants.id FROM consultants WHERE consultants.user_id = (SELECT auth.uid())
    ))
  );

DROP POLICY IF EXISTS "Consultants can view own leads" ON public.leads;
CREATE POLICY "Consultants can view own leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'consultant'::app_role)
    AND (consultant_id IN (
      SELECT consultants.id FROM consultants WHERE consultants.user_id = (SELECT auth.uid())
    ))
  );

DROP POLICY IF EXISTS "Publishers can view leads from their source" ON public.leads;
CREATE POLICY "Publishers can view leads from their source" ON public.leads
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'publisher'::app_role)
    AND ((source)::text IN (
      SELECT publishers.source FROM publishers
      WHERE publishers.user_id = (SELECT auth.uid()) AND publishers.is_active = true
    ))
  );

DROP POLICY IF EXISTS "Staff can insert leads" ON public.leads;
CREATE POLICY "Staff can insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Staff can update leads" ON public.leads;
CREATE POLICY "Staff can update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
  );

DROP POLICY IF EXISTS "Staff can view leads" ON public.leads;
CREATE POLICY "Staff can view leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
    OR can_view_lead((SELECT auth.uid()), id)
  );

DROP POLICY IF EXISTS "Super admin can delete leads" ON public.leads;
CREATE POLICY "Super admin can delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- lead_activities
-- =============================================================================

DROP POLICY IF EXISTS "Consultants can insert lead_activities" ON public.lead_activities;
CREATE POLICY "Consultants can insert lead_activities" ON public.lead_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'consultant'::app_role)
    AND (lead_id IN (
      SELECT l.id FROM leads l
      JOIN consultants c ON c.id = l.consultant_id
      WHERE c.user_id = (SELECT auth.uid())
    ))
  );

DROP POLICY IF EXISTS "Staff can insert lead activities" ON public.lead_activities;
CREATE POLICY "Staff can insert lead activities" ON public.lead_activities
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can view lead activities" ON public.lead_activities;
CREATE POLICY "Staff can view lead activities" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'publisher'::app_role)
  );

DROP POLICY IF EXISTS "Super admin can delete lead_activities" ON public.lead_activities;
CREATE POLICY "Super admin can delete lead_activities" ON public.lead_activities
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- lead_followups
-- =============================================================================

DROP POLICY IF EXISTS "Staff can manage followups" ON public.lead_followups;
CREATE POLICY "Staff can manage followups" ON public.lead_followups
  FOR ALL TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
  );

DROP POLICY IF EXISTS "Super admin can delete lead_followups" ON public.lead_followups;
CREATE POLICY "Super admin can delete lead_followups" ON public.lead_followups
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- lead_notes
-- =============================================================================

DROP POLICY IF EXISTS "Staff can manage lead notes" ON public.lead_notes;
CREATE POLICY "Staff can manage lead notes" ON public.lead_notes
  FOR ALL TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
  );

DROP POLICY IF EXISTS "Super admin can delete lead_notes" ON public.lead_notes;
CREATE POLICY "Super admin can delete lead_notes" ON public.lead_notes
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- whatsapp_messages
-- =============================================================================

DROP POLICY IF EXISTS "Staff can read whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can read whatsapp_messages" ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
  );

DROP POLICY IF EXISTS "Staff can update whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Staff can update whatsapp_messages" ON public.whatsapp_messages
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
  );

DROP POLICY IF EXISTS "Super admin can delete whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Super admin can delete whatsapp_messages" ON public.whatsapp_messages
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- ai_call_records
-- =============================================================================

DROP POLICY IF EXISTS "System can update ai_call_records" ON public.ai_call_records;
CREATE POLICY "System can update ai_call_records" ON public.ai_call_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = (SELECT auth.uid()))
  );

-- =============================================================================
-- applications
-- =============================================================================

DROP POLICY IF EXISTS "Applicants update own application by email" ON public.applications;
CREATE POLICY "Applicants update own application by email" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(COALESCE((SELECT current_user_email()), ''))
    AND COALESCE((SELECT current_user_email()), '') <> ''
  )
  WITH CHECK (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(COALESCE((SELECT current_user_email()), ''))
    AND COALESCE((SELECT current_user_email()), '') <> ''
  );

DROP POLICY IF EXISTS "Applicants update own application by phone" ON public.applications;
CREATE POLICY "Applicants update own application by phone" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(COALESCE((SELECT current_user_phone()), ''), '\D', '', 'g')
    AND COALESCE((SELECT current_user_phone()), '') <> ''
  )
  WITH CHECK (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(COALESCE((SELECT current_user_phone()), ''), '\D', '', 'g')
    AND COALESCE((SELECT current_user_phone()), '') <> ''
  );

DROP POLICY IF EXISTS "Applicants view own application by email" ON public.applications;
CREATE POLICY "Applicants view own application by email" ON public.applications
  FOR SELECT TO authenticated
  USING (
    email IS NOT NULL AND email <> ''
    AND lower(email) = lower(COALESCE((SELECT current_user_email()), ''))
    AND COALESCE((SELECT current_user_email()), '') <> ''
  );

DROP POLICY IF EXISTS "Applicants view own application by phone" ON public.applications;
CREATE POLICY "Applicants view own application by phone" ON public.applications
  FOR SELECT TO authenticated
  USING (
    phone IS NOT NULL AND phone <> ''
    AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(COALESCE((SELECT current_user_phone()), ''), '\D', '', 'g')
    AND COALESCE((SELECT current_user_phone()), '') <> ''
  );

DROP POLICY IF EXISTS "Only super_admin can delete applications" ON public.applications;
CREATE POLICY "Only super_admin can delete applications" ON public.applications
  FOR DELETE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    AND (payment_status IS DISTINCT FROM 'paid'::text)
  );

DROP POLICY IF EXISTS "Staff update applications" ON public.applications;
CREATE POLICY "Staff update applications" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'office_assistant'::app_role)
    OR has_role((SELECT auth.uid()), 'accountant'::app_role)
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'office_assistant'::app_role)
    OR has_role((SELECT auth.uid()), 'accountant'::app_role)
  );

DROP POLICY IF EXISTS "Staff view all applications" ON public.applications;
CREATE POLICY "Staff view all applications" ON public.applications
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'office_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'office_assistant'::app_role)
    OR has_role((SELECT auth.uid()), 'accountant'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
  );

-- =============================================================================
-- call_logs
-- =============================================================================

DROP POLICY IF EXISTS "Staff can manage call logs" ON public.call_logs;
CREATE POLICY "Staff can manage call logs" ON public.call_logs
  FOR ALL TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
  );

DROP POLICY IF EXISTS "Super admin can delete call_logs" ON public.call_logs;
CREATE POLICY "Super admin can delete call_logs" ON public.call_logs
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

-- =============================================================================
-- profiles
-- =============================================================================

DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO public
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;
CREATE POLICY "Staff can view all profiles" ON public.profiles
  FOR SELECT TO public
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'counsellor'::app_role)
    OR has_role((SELECT auth.uid()), 'accountant'::app_role)
    OR has_role((SELECT auth.uid()), 'faculty'::app_role)
    OR has_role((SELECT auth.uid()), 'teacher'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
    OR has_role((SELECT auth.uid()), 'office_assistant'::app_role)
    OR has_role((SELECT auth.uid()), 'hostel_warden'::app_role)
  );

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- user_roles
-- =============================================================================

DROP POLICY IF EXISTS "Admin roles can view all user_roles" ON public.user_roles;
CREATE POLICY "Admin roles can view all user_roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
  );

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO public
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO public
  WITH CHECK (has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO public
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT TO public
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- =============================================================================
-- teams
-- =============================================================================

DROP POLICY IF EXISTS "Admins can manage teams" ON public.teams;
CREATE POLICY "Admins can manage teams" ON public.teams
  FOR ALL TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
  )
  WITH CHECK (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
  );

-- =============================================================================
-- departments
-- =============================================================================

DROP POLICY IF EXISTS "Admins can manage departments" ON public.departments;
CREATE POLICY "Admins can manage departments" ON public.departments
  FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'super_admin'::app_role));
