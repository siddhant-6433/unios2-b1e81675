-- Sprint 2 Feature 4: Duplicate Lead Detection

-- Enable trigram extension for fuzzy name matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on lead names
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON public.leads USING gin (name gin_trgm_ops);
-- Exact phone lookup index
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);

-- Function: find exact phone duplicates
CREATE OR REPLACE FUNCTION public.find_phone_duplicates(p_phone text, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, name text, phone text, stage text, counsellor_id uuid, created_at timestamptz) AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.name, l.phone, l.stage::text, l.counsellor_id, l.created_at
  FROM public.leads l
  WHERE l.phone = p_phone
    AND (p_exclude_id IS NULL OR l.id != p_exclude_id)
  LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: find fuzzy name duplicates
CREATE OR REPLACE FUNCTION public.find_name_duplicates(p_name text, p_exclude_id uuid DEFAULT NULL, p_threshold float DEFAULT 0.4)
RETURNS TABLE(id uuid, name text, phone text, stage text, similarity float) AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.name, l.phone, l.stage::text, similarity(l.name, p_name)::float
  FROM public.leads l
  WHERE l.id != COALESCE(p_exclude_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND similarity(l.name, p_name) > p_threshold
  ORDER BY similarity(l.name, p_name) DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql STABLE;

-- Audit trail for merges
CREATE TABLE public.lead_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  merged_lead_id uuid NOT NULL,
  merged_lead_snapshot jsonb NOT NULL,
  merged_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.lead_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage lead_merges"
  ON public.lead_merges FOR ALL TO authenticated USING (true) WITH CHECK (true);
