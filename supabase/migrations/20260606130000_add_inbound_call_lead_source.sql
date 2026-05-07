-- Add `inbound_call` to the lead_source enum so the AI voice agent can
-- attribute leads created from inbound phone calls correctly.
--
-- Why: Until now, inbound calls from numbers not in CRM produced no lead
-- row at all (silent ghost calls). The fix in voice-agent/server.ts now
-- auto-creates a lead on first inbound contact, but that lead needs a
-- proper source label — `walk_in` was being used as a stopgap and is
-- semantically wrong (the caller did not walk in).

ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'inbound_call';
