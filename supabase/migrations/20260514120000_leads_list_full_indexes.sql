-- Non-partial composite indexes for the Admissions list view query
-- (counsellor / campus / global ORDER BY created_at DESC LIMIT 50).
-- The previously-added partial indexes only match when the query also
-- filters is_mirror = false, which the Admissions list intentionally does
-- not do (school mirror leads need to appear in the list).
CREATE INDEX IF NOT EXISTS idx_leads_counsellor_created_all
  ON public.leads (counsellor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_campus_created_all
  ON public.leads (campus_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_created_all
  ON public.leads (created_at DESC);
