-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260812033947 name=grant_anon_execute_course_affiliation_label applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- course_marketing_info calls fn_course_affiliation_label(c.id) for its
-- `affiliation` column, so the SELECT grant on the view alone is not enough —
-- PostgREST returns 42501 "permission denied for function". Caught by an actual
-- anon HTTP request; the grant/dependency checks did not surface it.
--
-- The function is SECURITY DEFINER and returns only a public affiliation label
-- for a course id, so anon EXECUTE is safe. fn_course_facts is deliberately NOT
-- granted: the website reads through the view, not the resolver.
GRANT EXECUTE ON FUNCTION public.fn_course_affiliation_label(uuid) TO anon;
