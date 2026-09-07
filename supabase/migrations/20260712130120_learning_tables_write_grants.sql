-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712130120 name=learning_tables_write_grants applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Super admins / admission heads could not approve or answer anything in the
-- Navya Knowledge page: the learning tables only granted SELECT to
-- authenticated, so the RLS manage policies (super_admin / admission_head)
-- had no table-level privilege to act on. RLS continues to gate WHO can
-- write; these grants just make the policies effective.

grant insert, update on public.admissions_ai_reply_examples to authenticated;
grant insert, update on public.voice_knowledge_gaps to authenticated;
