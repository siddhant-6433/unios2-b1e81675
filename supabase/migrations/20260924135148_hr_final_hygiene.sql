-- HR final hygiene — the small audit leftovers:
--   * reconcile the legacy flat leave balances into the entitlements engine and
--     make the legacy table read-only
--   * revoke the stale anon SELECT on geofence_locations
--   * collapse the duplicate employee_profiles RLS policies
--   * enforce the canonical job_openings slug uniqueness

-- ── 1. Legacy leave balances → entitlements ─────────────────────────────────

INSERT INTO public.employee_leave_entitlements
  (employee_profile_id, leave_type_id, leave_year, entitled_days, used_days)
SELECT e.id, t.id, b.year, b.total_days, b.used_days
  FROM public.employee_leave_balances b
  JOIN public.employee_profiles e ON e.user_id = b.user_id
  JOIN public.leave_types t
    ON t.leave_plan_id = COALESCE(e.leave_plan_id, (SELECT id FROM public.leave_plans WHERE is_default LIMIT 1))
   AND t.code = CASE lower(b.leave_type)
                  WHEN 'casual' THEN 'CL'
                  WHEN 'sick'   THEN 'SL'
                  WHEN 'earned' THEN 'EL'
                  WHEN 'unpaid' THEN 'LWP'
                  ELSE upper(b.leave_type)
                END
 WHERE b.year IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.employee_leave_entitlements x
      WHERE x.employee_profile_id = e.id
        AND x.leave_type_id = t.id
        AND x.leave_year = b.year
   );

COMMENT ON TABLE public.employee_leave_balances IS
  'Deprecated legacy flat leave balances. Superseded by employee_leave_entitlements and backfilled once; kept read-only for reference.';

-- No longer a writable source of truth: the UI and RPCs use entitlements.
REVOKE INSERT, UPDATE, DELETE ON public.employee_leave_balances FROM authenticated;

-- ── 2. Stale anon grant ─────────────────────────────────────────────────────
-- The RLS policy is already authenticated-only, so this grant was a latent
-- exposure with no legitimate use.
REVOKE SELECT ON public.geofence_locations FROM anon;

-- ── 3. De-duplicate employee_profiles policies ──────────────────────────────
-- Two generations of permission policies were stacked. Keep the newer
-- has_permission ones and drop the older get_user_permissions duplicates, plus
-- the principal-only policy now covered by hr:view.
DROP POLICY IF EXISTS "HR reads employee profiles" ON public.employee_profiles;
DROP POLICY IF EXISTS "HR writes employee profiles" ON public.employee_profiles;
DROP POLICY IF EXISTS "HR staff can view all employee profiles" ON public.employee_profiles;

-- ── 4. Canonical job_openings slug uniqueness ───────────────────────────────
-- job_openings was declared twice; the second declaration dropped the UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS job_openings_slug_uniq
  ON public.job_openings (slug);
