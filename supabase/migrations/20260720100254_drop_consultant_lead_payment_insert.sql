-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260720100254 name=drop_consultant_lead_payment_insert applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP POLICY IF EXISTS "Consultants can record payments for own leads" ON public.lead_payments;
