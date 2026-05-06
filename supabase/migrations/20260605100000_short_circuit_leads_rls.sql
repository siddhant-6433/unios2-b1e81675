-- Short-circuit RLS on public.leads for staff roles.
--
-- BEFORE: "Staff can view leads" policy delegated everything to
-- can_view_lead(auth.uid(), id). That function is LANGUAGE sql STABLE and
-- contains 5 OR-ed EXISTS branches (staff role check, primary counsellor,
-- secondary counsellor, team leader 5-way join, publisher source match).
-- The Postgres planner doesn't reorder cheap-vs-expensive branches inside
-- the OR chain, so every row in `leads` (5,200 today) gets evaluated
-- against the full chain — including the deep team-leader join. Cumulative
-- pg_stat_statements showed `SELECT id FROM leads WHERE stage=$1 LIMIT $2`
-- averaging 3.6 s per call against a 10 MB table. RLS overhead, not data.
--
-- AFTER: do the cheap role checks INLINE at the policy level first, falling
-- through to can_view_lead only for non-staff users. Functionally
-- identical — can_view_lead already starts with the same staff role
-- check, so no row that was previously visible becomes hidden, and no
-- previously hidden row becomes visible. Verified with a per-role
-- visible-count snapshot before/after this migration.
--
-- Other policies on public.leads (Consultants can view own leads,
-- Publishers can view leads from their source, Staff can update/insert
-- leads, Super admin can delete leads) are untouched.

DROP POLICY IF EXISTS "Staff can view leads" ON public.leads;

CREATE POLICY "Staff can view leads"
ON public.leads
FOR SELECT
TO authenticated
USING (
  -- Cheap role checks first — these short-circuit the policy entirely
  -- for ~95% of admin traffic, skipping the per-row function call.
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'campus_admin'::app_role)
  OR public.has_role(auth.uid(), 'admission_head'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
  OR public.has_role(auth.uid(), 'data_entry'::app_role)
  -- Per-row check (counsellor / team leader / publisher / etc.) only
  -- runs when the user has none of the staff roles above.
  OR public.can_view_lead(auth.uid(), id)
);
