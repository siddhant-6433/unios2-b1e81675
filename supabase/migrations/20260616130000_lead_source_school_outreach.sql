-- Add "school_outreach" to lead_source enum.
--
-- Counsellors collect names + phones during in-school visits / drives at
-- partner schools; tagging these distinctly lets us segment them in buckets
-- and analytics instead of lumping them under "other".

ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'school_outreach';
