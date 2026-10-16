-- keep-migration-version: already recorded on production schema_migrations
-- crm sla adjustment single active exception

-- Prevent repeated appeals from stacking multiple point exemptions on one event.
CREATE UNIQUE INDEX crm_sla_adjustment_one_active_per_event
  ON public.crm_sla_adjustment_requests(event_type, event_id)
  WHERE status IN ('pending','approved');
