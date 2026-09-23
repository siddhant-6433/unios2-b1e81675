-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260923052956; git must keep this timestamp for `db push`.
--
-- Branches the caller can actually operate, for the mobile scanner and any client
-- that should not have to reason about role fallback vs explicit assignment.
--
-- The Expo library screen previously listed branches only from
-- library_staff_assignments, so a librarian operating via the campus role fallback
-- (no assignment row) saw no library to scan into.
CREATE OR REPLACE FUNCTION public.library_my_branches(_action text DEFAULT 'view')
RETURNS SETOF public.library_branches
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.*
  FROM public.library_branches b
  WHERE b.active
    AND b.id = ANY(public.library_accessible_branch_ids(auth.uid(), _action))
  ORDER BY b.name;
$$;

REVOKE EXECUTE ON FUNCTION public.library_my_branches(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.library_my_branches(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.library_my_branches(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
