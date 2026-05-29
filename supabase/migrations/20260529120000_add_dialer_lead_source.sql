-- Add "dialer" to lead_source enum.
--
-- The Cloud Dialer's "Create & Call" flow inserts a stub lead with
-- source = 'dialer' (see src/pages/CloudDialer.tsx dialCreateAndCall), but the
-- value was never added to the enum, so the insert failed with
-- "invalid input value for enum lead_source: \"dialer\"". Tagging these leads
-- distinctly lets us segment counsellor-originated dialer leads in analytics
-- instead of lumping them under "other".

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'dialer';
