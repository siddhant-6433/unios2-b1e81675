-- Add is_mirror flag to leads table so mirror-paired school leads
-- can be excluded from global stats counts to avoid double-counting.
-- In each pair, the second-created lead (auto-created by trigger) is the mirror.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_mirror boolean NOT NULL DEFAULT false;

-- Mark existing mirrors: in each pair, the one created later is the mirror
UPDATE public.leads l
SET is_mirror = true
WHERE mirror_lead_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.leads l2
    WHERE l2.id = l.mirror_lead_id
      AND l2.created_at <= l.created_at
      AND l2.id < l.id  -- tiebreak by id if same timestamp
  );

-- Index for fast filtering of non-mirror leads
CREATE INDEX IF NOT EXISTS idx_leads_is_mirror ON public.leads(is_mirror) WHERE is_mirror = true;
