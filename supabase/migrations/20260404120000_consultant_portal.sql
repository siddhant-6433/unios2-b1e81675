-- Sprint 4 Feature 3: Consultant/Agent Portal

-- Add consultant role
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'consultant';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Link consultants to auth users
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultants_user ON public.consultants(user_id) WHERE user_id IS NOT NULL;

-- Consultant dashboard stats view
CREATE OR REPLACE VIEW public.consultant_dashboard AS
SELECT
  c.id AS consultant_id,
  c.user_id,
  c.name AS consultant_name,
  c.phone AS consultant_phone,
  c.email AS consultant_email,
  c.commission_type,
  c.commission_value,
  COUNT(l.id) AS total_leads,
  COUNT(l.id) FILTER (WHERE l.stage = 'admitted') AS conversions,
  COUNT(l.id) FILTER (WHERE l.stage NOT IN ('rejected', 'admitted')) AS pipeline,
  COALESCE(SUM(CASE
    WHEN l.stage = 'admitted' AND c.commission_type = 'fixed' THEN c.commission_value
    WHEN l.stage = 'admitted' AND c.commission_type = 'percentage' AND l.offer_amount IS NOT NULL
      THEN (l.offer_amount * c.commission_value / 100)
    ELSE 0
  END), 0)::numeric(12,2) AS total_commission
FROM public.consultants c
LEFT JOIN public.leads l ON l.consultant_id = c.id
GROUP BY c.id;

GRANT SELECT ON public.consultant_dashboard TO authenticated;
