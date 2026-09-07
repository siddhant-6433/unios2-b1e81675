-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260805125827 name=concessions_fee_ledger_fk_cascade applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.concessions
  DROP CONSTRAINT IF EXISTS concessions_fee_ledger_id_fkey;

ALTER TABLE public.concessions
  ADD CONSTRAINT concessions_fee_ledger_id_fkey
  FOREIGN KEY (fee_ledger_id) REFERENCES public.fee_ledger(id) ON DELETE CASCADE;
