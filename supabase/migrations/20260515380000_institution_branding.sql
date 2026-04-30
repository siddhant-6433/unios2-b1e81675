-- ====================================================================
-- Institution branding registry
--   Lets super-admins upload one letterhead per institution (NIMT
--   college / NIMT School / NIMT Beacon / Mirai / …) plus signature,
--   address, GSTIN, etc. Powers offer-letter PDFs, payment receipts,
--   and any future doc generators (admission letter, TC, bona-fide).
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.institution_branding (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text UNIQUE NOT NULL,        -- 'nimt' | 'nimt_school' | 'mirai' | …
  name                  text NOT NULL,               -- "NIMT Educational Institutions"
  letterhead_url        text,                        -- A4 background image (PNG/JPG)
  footer_url            text,                        -- optional separate footer band image
  signature_url         text,                        -- approving authority's signature
  signatory_name        text,
  signatory_designation text,
  address               text,
  contact_email         text,
  contact_phone         text,
  website               text,
  gstin                 text,
  is_default            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branding_default_singleton
  ON public.institution_branding ((true)) WHERE is_default = true;

ALTER TABLE public.institution_branding ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (so the doc generators have access).
CREATE POLICY "Branding readable by authenticated"
  ON public.institution_branding FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admin manages branding"
  ON public.institution_branding FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.institution_branding TO authenticated;
GRANT ALL ON public.institution_branding TO service_role;

-- Updated_at trigger (reuses the project-wide helper).
DROP TRIGGER IF EXISTS update_branding_updated_at ON public.institution_branding;
CREATE TRIGGER update_branding_updated_at
  BEFORE UPDATE ON public.institution_branding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Wire campuses to a branding record. Defaults to NULL → docs fall back
-- to the `is_default = true` row.
ALTER TABLE public.campuses
  ADD COLUMN IF NOT EXISTS branding_slug text REFERENCES public.institution_branding(slug) ON DELETE SET NULL;

-- Seed a default record so document generators have something to pick.
INSERT INTO public.institution_branding (slug, name, is_default, address, contact_email, website)
VALUES (
  'nimt',
  'NIMT Educational Institutions',
  true,
  'NIMT Campus, Loni Road, Modinagar (Ghaziabad)',
  'admissions@nimt.ac.in',
  'https://www.nimt.ac.in'
)
ON CONFLICT (slug) DO NOTHING;

-- Helper: resolve the branding row for a given lead/campus, with default fallback.
CREATE OR REPLACE FUNCTION public.lead_branding(_lead_id uuid)
RETURNS public.institution_branding
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH chain AS (
    SELECT ib.*
      FROM public.leads l
      LEFT JOIN public.campuses c ON c.id = l.campus_id
      LEFT JOIN public.institution_branding ib ON ib.slug = c.branding_slug
     WHERE l.id = _lead_id AND ib.id IS NOT NULL
     UNION ALL
    SELECT ib.* FROM public.institution_branding ib WHERE ib.is_default = true
  )
  SELECT * FROM chain LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lead_branding TO authenticated, service_role;
