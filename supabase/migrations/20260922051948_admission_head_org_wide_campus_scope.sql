-- Admission Head is an org-wide role, not a campus-scoped one.
--
-- Context: the campus-isolation migration (20260918085938) campus-scoped
-- admission_head on leads, campus_visits, students, applications and the
-- admissions sub-tables via user_can_access_assigned_campus(). An admission
-- head whose profiles.campus has no matching campus therefore matched no rows,
-- and the CRM funnel/list/stats/visits rendered zero (while the org-wide header
-- badges still showed the real totals).
--
-- admission_head is treated as an org-wide admissions role everywhere else in
-- the product (GlobalActionBar lead-pendency counts, the call_logs select
-- policy, approvals panels). This migration restores that: it adds permissive
-- policies granting admission_head the same verbs it already had, but across
-- every campus.
--
-- PostgreSQL ORs permissive policies, so these ADD policies widen access for
-- admission_head only. Every other role's campus scope is untouched.
--
-- Frontend counterpart: src/contexts/CampusContext.tsx now lists
-- admission_head in ORG_WIDE_CAMPUS_ROLES so it defaults to "All Campuses"
-- instead of the "No assigned campus" sentinel.

-- ── leads ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can view all leads" ON public.leads;
CREATE POLICY "Admission head can view all leads" ON public.leads
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can insert leads" ON public.leads;
CREATE POLICY "Admission head can insert leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can update leads" ON public.leads;
CREATE POLICY "Admission head can update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── campus_visits / lead_notes / lead_followups (FOR ALL in the base policy) ─
DROP POLICY IF EXISTS "Admission head can manage all visits" ON public.campus_visits;
CREATE POLICY "Admission head can manage all visits" ON public.campus_visits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can manage all lead notes" ON public.lead_notes;
CREATE POLICY "Admission head can manage all lead notes" ON public.lead_notes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can manage all followups" ON public.lead_followups;
CREATE POLICY "Admission head can manage all followups" ON public.lead_followups
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── applications ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can view all applications" ON public.applications;
CREATE POLICY "Admission head can view all applications" ON public.applications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can update applications" ON public.applications;
CREATE POLICY "Admission head can update applications" ON public.applications
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── students ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can view all students" ON public.students;
CREATE POLICY "Admission head can view all students" ON public.students
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can insert students" ON public.students;
CREATE POLICY "Admission head can insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can update students" ON public.students;
CREATE POLICY "Admission head can update students" ON public.students
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── lead_payments ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can read all lead payments" ON public.lead_payments;
CREATE POLICY "Admission head can read all lead payments" ON public.lead_payments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can insert lead payments" ON public.lead_payments;
CREATE POLICY "Admission head can insert lead payments" ON public.lead_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── offer_waivers ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can view all offer waivers" ON public.offer_waivers;
CREATE POLICY "Admission head can view all offer waivers" ON public.offer_waivers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

-- ── offer_letters ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admission head can select all offers" ON public.offer_letters;
CREATE POLICY "Admission head can select all offers" ON public.offer_letters
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can insert offers" ON public.offer_letters;
CREATE POLICY "Admission head can insert offers" ON public.offer_letters
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

DROP POLICY IF EXISTS "Admission head can update offers" ON public.offer_letters;
CREATE POLICY "Admission head can update offers" ON public.offer_letters
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admission_head'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admission_head'::app_role));

NOTIFY pgrst, 'reload schema';
