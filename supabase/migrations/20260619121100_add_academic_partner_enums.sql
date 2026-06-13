-- Academic Partner role and lead source.
-- Kept separate from schema usage because new enum values cannot be used
-- safely in the same migration transaction on all Postgres versions.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'academic_partner';
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'academic_partner';
