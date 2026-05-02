-- Capture the JustDial contract / branch identifier on each lead.
-- JD's API field name varies by subscription tier (branchid / parentid /
-- contract_id / contractid). We populate the first non-empty candidate at
-- ingest time. See supabase/functions/justdial-ingest/index.ts.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS jd_contract_id text;

CREATE INDEX IF NOT EXISTS leads_jd_contract_id_idx
  ON public.leads (jd_contract_id)
  WHERE jd_contract_id IS NOT NULL;

-- Backfill from existing notes where the ingest function previously logged
-- "JD Parent ID: <value>". Notes look like:
--   "JD Category: MBA Colleges | City: Delhi | JD Parent ID: 12345678"
UPDATE public.leads
SET jd_contract_id = (regexp_match(notes, 'JD Parent ID:\s*([^\s|]+)'))[1]
WHERE source = 'justdial'
  AND jd_contract_id IS NULL
  AND notes ~ 'JD Parent ID:';
