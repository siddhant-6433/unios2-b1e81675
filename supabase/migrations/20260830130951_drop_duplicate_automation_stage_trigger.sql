-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260830130951 name=drop_duplicate_automation_stage_trigger applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP TRIGGER IF EXISTS trg_automation_stage_change ON public.leads;
DROP FUNCTION IF EXISTS public.fn_trigger_automation_on_stage_change();
