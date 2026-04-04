-- Fix missing table-level grants for jd_category_mappings.
-- Without these, RLS policies are never evaluated for authenticated users
-- and queries silently return 0 rows (causing the dashboard panel to be invisible).

GRANT SELECT         ON public.jd_category_mappings TO authenticated;
GRANT UPDATE (status, course_id, is_school, resolved_by, resolved_at)
             ON public.jd_category_mappings TO authenticated;
