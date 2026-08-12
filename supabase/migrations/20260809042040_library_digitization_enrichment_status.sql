-- Track the outcome of "Auto-fill from web" per digitization record so the review queue can
-- badge + filter by it. NULL = not attempted, 'enriched' = a web match was found and applied,
-- 'no_match' = auto-fetch ran but found nothing online (needs manual entry / cover upload).
ALTER TABLE public.library_digitization_records
  ADD COLUMN IF NOT EXISTS enrichment_status text;
