-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260720100258 name=owner_assigners_read_external_owner_lists applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE POLICY "Owner-assigners can view academic partners"
  ON public.academic_partners FOR SELECT TO authenticated
  USING (public.can_assign_lead_external_owner(auth.uid()));

CREATE POLICY "Owner-assigners can view consultants"
  ON public.consultants FOR SELECT TO authenticated
  USING (public.can_assign_lead_external_owner(auth.uid()));
