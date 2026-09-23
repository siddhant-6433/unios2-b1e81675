-- Rollout: enable the CBSE assessments (Beacon Academics) module.
-- The browser (VITE_BEACON_ACADEMICS_ENABLED) and the PDF edge function
-- (BEACON_ACADEMICS_ENABLED) are gated separately.
update public._app_config set value='true' where key='beacon_academics_enabled';
