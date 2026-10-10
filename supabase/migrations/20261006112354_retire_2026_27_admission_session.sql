-- keep-migration-version: already recorded on production schema_migrations
-- Restored from the production Supabase migration ledger to reconcile local history.

-- Keep the upcoming 2027-28 intake as the sole active admission session.
-- Retain the 2026-27 row for historical applications and leads that reference it.
UPDATE public.admission_sessions
SET is_active = (name = '2027-28')
WHERE is_active IS DISTINCT FROM (name = '2027-28');
