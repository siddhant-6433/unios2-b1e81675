-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260712123523 name=pending_offer_note applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

alter table public.applications
  add column if not exists pending_offer_note text;

comment on column public.applications.pending_offer_note is
  'Free-text note set when status=''approved'' (pending offer): explains why the offer letter has not been issued yet (e.g. "Waiting for Counselling").';
