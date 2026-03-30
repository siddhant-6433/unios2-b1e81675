-- Add source_lead_id to store the external lead ID from the originating platform
-- (e.g. Collegedunia Analytics ID, JustDial leadid, Shiksha lead_id)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source_lead_id text;

COMMENT ON COLUMN public.leads.source_lead_id IS
  'External lead identifier from the originating platform (e.g. Collegedunia Analytics ID, JustDial leadid, Shiksha lead_id)';
