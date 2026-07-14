-- Allow one fee proposal to cover multiple linked leads/applicants.

ALTER TABLE public.fee_proposals
  ADD COLUMN IF NOT EXISTS linked_lead_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS idx_fee_proposals_linked_leads
  ON public.fee_proposals USING gin (linked_lead_ids);

COMMENT ON COLUMN public.fee_proposals.linked_lead_ids IS
  'Additional lead IDs covered by this proposal. lead_id remains the primary lead for compatibility.';
