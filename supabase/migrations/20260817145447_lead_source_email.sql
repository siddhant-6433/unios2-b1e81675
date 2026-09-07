-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260817145447 name=lead_source_email applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Add 'email' to the lead_source enum so the email reply agent can create leads
-- from inbound enquiries. Kept in its OWN migration: Postgres cannot use a newly
-- added enum value in the same transaction that adds it, and the next migration
-- (20260802141013_email_ai_reply) / the edge function insert 'email' leads.
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'email';
