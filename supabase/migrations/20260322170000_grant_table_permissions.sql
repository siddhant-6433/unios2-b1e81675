-- Grant SELECT/INSERT/UPDATE/DELETE on core tables to authenticated role
-- and SELECT on public-facing tables to anon role
-- (RLS policies exist but table-level GRANTs were missing)

-- ── Public-facing tables (readable by everyone, even unauthenticated) ──
GRANT SELECT ON public.campuses           TO anon, authenticated;
GRANT SELECT ON public.institutions       TO anon, authenticated;
GRANT SELECT ON public.departments        TO anon, authenticated;
GRANT SELECT ON public.courses            TO anon, authenticated;
GRANT SELECT ON public.admission_sessions TO anon, authenticated;
GRANT SELECT ON public.eligibility_rules  TO anon, authenticated;
GRANT SELECT ON public.batches            TO anon, authenticated;

-- ── Admin-managed tables (authenticated only) ──
GRANT INSERT, UPDATE, DELETE ON public.campuses           TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.institutions       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.departments        TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.courses            TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.admission_sessions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eligibility_rules  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.batches            TO authenticated;

-- ── Application tables ──
GRANT SELECT, INSERT, UPDATE ON public.applications TO anon, authenticated;

-- ── Leads, Students (authenticated staff/admin only) ──
GRANT SELECT, INSERT, UPDATE ON public.leads           TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lead_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.students        TO authenticated;

-- ── Finance (authenticated) ──
GRANT SELECT ON public.fee_codes            TO authenticated;
GRANT SELECT ON public.fee_structures       TO authenticated;
GRANT SELECT ON public.fee_structure_items  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fee_ledger      TO authenticated;
GRANT SELECT, INSERT ON public.payments     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.concessions     TO authenticated;
