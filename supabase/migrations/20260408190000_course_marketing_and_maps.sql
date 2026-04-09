-- Add Google Maps URL to campuses
ALTER TABLE public.campuses ADD COLUMN IF NOT EXISTS google_maps_url text;

-- Add application form URL to campuses (e.g. https://app.nimt.ac.in/apply/nimt)
ALTER TABLE public.campuses ADD COLUMN IF NOT EXISTS apply_url text;

-- Seed maps URLs (update with actual URLs)
UPDATE public.campuses SET google_maps_url = 'https://maps.google.com/?q=NIMT+Greater+Noida', apply_url = 'https://app.nimt.ac.in/apply/nimt' WHERE code = 'GN';
UPDATE public.campuses SET google_maps_url = 'https://maps.google.com/?q=NIMT+Kotputli', apply_url = 'https://app.nimt.ac.in/apply/nimt' WHERE code = 'KT';
UPDATE public.campuses SET google_maps_url = 'https://maps.google.com/?q=NIMT+Ghaziabad', apply_url = 'https://app.nimt.ac.in/apply/nimt' WHERE code LIKE 'GZ%';
