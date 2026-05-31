-- Pure performance improvement to the "Staff can view leads" RLS policy.
-- Adds a fast path for counsellors viewing their own assigned leads, bypassing
-- the expensive 5-branch can_view_lead() function for the most common case.
--
-- LOGIC UNCHANGED: counsellors could already see their own leads via
-- can_view_lead() → branch 2 (primary counsellor check). This short-circuits
-- that path at the policy level using an indexed lookup on leads.counsellor_id +
-- profiles.user_id, so can_view_lead() is skipped for those rows.
--
-- Counsellors who are also team leaders still fall through to can_view_lead()
-- for leads not assigned directly to them (those rows don't match the fast path).
-- The visible row set is identical to before this migration.

DROP POLICY IF EXISTS "Staff can view leads" ON public.leads;
CREATE POLICY "Staff can view leads" ON public.leads
  FOR SELECT TO authenticated
  USING (
    has_role((SELECT auth.uid()), 'super_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'campus_admin'::app_role)
    OR has_role((SELECT auth.uid()), 'admission_head'::app_role)
    OR has_role((SELECT auth.uid()), 'principal'::app_role)
    OR has_role((SELECT auth.uid()), 'data_entry'::app_role)
    -- Counsellor fast path: own assigned leads via indexed counsellor_id lookup.
    -- Avoids the per-row 5-branch can_view_lead() call for ~99% of counsellor
    -- read traffic (counsellors almost always query their own leads).
    OR (
      has_role((SELECT auth.uid()), 'counsellor'::app_role)
      AND counsellor_id IN (
        SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid())
      )
    )
    -- Full per-row check for unassigned leads, team leaders, publishers, etc.
    OR can_view_lead((SELECT auth.uid()), id)
  );
