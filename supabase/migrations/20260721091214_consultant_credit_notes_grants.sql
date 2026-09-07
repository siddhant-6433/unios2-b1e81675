-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260721091214 name=consultant_credit_notes_grants applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Frontend reads these directly (RLS gates rows); writes go via SECURITY DEFINER RPCs.
GRANT SELECT ON public.consultant_credit_notes TO authenticated;
GRANT SELECT ON public.consultant_credit_note_applications TO authenticated;
GRANT SELECT ON public.consultant_credit_note_summary TO authenticated;
