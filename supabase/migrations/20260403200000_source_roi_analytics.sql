-- Sprint 3 Feature 1: Source ROI Analytics

-- Ad spend tracking per source per month
CREATE TABLE public.source_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  month date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  recorded_by uuid REFERENCES public.profiles(id),
  campus_id uuid REFERENCES public.campuses(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_source_ad_spend_unique
  ON public.source_ad_spend(source, month, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX idx_source_ad_spend_lookup ON public.source_ad_spend(source, month);

ALTER TABLE public.source_ad_spend ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage source_ad_spend"
  ON public.source_ad_spend FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Consultant tracking FK on leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS consultant_id uuid REFERENCES public.consultants(id);

-- Source ROI summary view
CREATE OR REPLACE VIEW public.source_roi_summary AS
SELECT
  l.source::text AS source,
  date_trunc('month', l.created_at)::date AS month,
  COUNT(*) AS total_leads,
  COUNT(*) FILTER (WHERE l.stage IN ('application_submitted','ai_called','counsellor_call','visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS applied,
  COUNT(*) FILTER (WHERE l.stage = 'admitted') AS admitted,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(COUNT(*) FILTER (WHERE l.stage = 'admitted')::numeric / COUNT(*) * 100, 1)
    ELSE 0
  END AS conversion_pct,
  COALESCE(sas.amount, 0) AS ad_spend,
  CASE WHEN COUNT(*) FILTER (WHERE l.stage = 'admitted') > 0 AND sas.amount IS NOT NULL
    THEN ROUND(sas.amount / COUNT(*) FILTER (WHERE l.stage = 'admitted'), 0)
    ELSE NULL
  END AS cost_per_admission
FROM public.leads l
LEFT JOIN public.source_ad_spend sas
  ON sas.source = l.source::text
  AND sas.month = date_trunc('month', l.created_at)::date
  AND sas.campus_id IS NULL
GROUP BY l.source, date_trunc('month', l.created_at)::date, sas.amount;

GRANT SELECT ON public.source_roi_summary TO authenticated;

-- Consultant ROI view
CREATE OR REPLACE VIEW public.consultant_roi_summary AS
SELECT
  c.id AS consultant_id,
  c.name AS consultant_name,
  c.phone AS consultant_phone,
  c.commission_type,
  c.commission_value,
  COUNT(l.id) AS total_leads,
  COUNT(l.id) FILTER (WHERE l.stage = 'admitted') AS admitted,
  CASE WHEN COUNT(l.id) > 0
    THEN ROUND(COUNT(l.id) FILTER (WHERE l.stage = 'admitted')::numeric / COUNT(l.id) * 100, 1)
    ELSE 0
  END AS conversion_pct
FROM public.consultants c
LEFT JOIN public.leads l ON l.consultant_id = c.id
GROUP BY c.id, c.name, c.phone, c.commission_type, c.commission_value;

GRANT SELECT ON public.consultant_roi_summary TO authenticated;
