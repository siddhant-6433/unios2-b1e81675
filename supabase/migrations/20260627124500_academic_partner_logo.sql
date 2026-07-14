-- Store an optional public logo for academic partner branding.

ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.academic_partners.logo_url IS
  'Public URL for the academic partner logo shown in admin and partner dashboard surfaces.';
