-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations to align db push history.
-- Git must keep this timestamp so `db push` matches remote history.
--
-- Rollout: enable the CBSE assessments (Beacon Academics) module.
-- The browser (VITE_BEACON_ACADEMICS_ENABLED) and the PDF edge function
-- (BEACON_ACADEMICS_ENABLED) are gated separately.
update public._app_config set value='true' where key='beacon_academics_enabled';
