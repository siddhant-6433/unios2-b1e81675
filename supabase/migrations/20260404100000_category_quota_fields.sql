-- Sprint 4 Feature 1: Category/Quota/Entrance Score Fields

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS state_domicile text,
  ADD COLUMN IF NOT EXISTS is_nri boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS gap_years integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entrance_scores jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS state_domicile text,
  ADD COLUMN IF NOT EXISTS gap_years integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_nri boolean DEFAULT false;

ALTER TABLE public.eligibility_rules
  ADD COLUMN IF NOT EXISTS nri_fee_multiplier numeric(3,2) DEFAULT 1.0;
