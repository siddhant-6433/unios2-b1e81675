-- RLS gaps for the `principal` role (which is also how team leaders are
-- identified in this project — there's no separate team_leader role; a
-- team leader is whoever is set as teams.leader_id and they happen to
-- carry the principal role).
--
-- Found during E2E test of admission lifecycle from team-leader login:
--   1. leads UPDATE policy excludes principal — application-approve flow
--      silently fails to advance stage to 'application_approved'.
--   2. lead_activities SELECT policy excludes principal — lead timeline
--      renders empty in their AdminApplicationView / LeadDetail.
--   3. offer_letters policy excludes principal — can't issue offers from
--      the team-leader login.
--
-- All three policies were created in 20260308151146 / 20260308165214.

-- 1. leads UPDATE
DROP POLICY IF EXISTS "Staff can update leads" ON public.leads;
CREATE POLICY "Staff can update leads" ON public.leads
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

-- 2. lead_activities SELECT
DROP POLICY IF EXISTS "Staff can view lead activities" ON public.lead_activities;
CREATE POLICY "Staff can view lead activities" ON public.lead_activities
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    -- Publishers can see activities for their own publisher leads (existing pattern)
    public.has_role(auth.uid(), 'publisher')
  );

-- 3. offer_letters ALL
DROP POLICY IF EXISTS "Staff can manage offers" ON public.offer_letters;
CREATE POLICY "Staff can manage offers" ON public.offer_letters
  FOR ALL TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor') OR
    public.has_role(auth.uid(), 'accountant')
  );
