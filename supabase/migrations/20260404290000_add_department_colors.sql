-- Add color column to departments for consistent branding across all surfaces
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS color text;

-- Set department colors (matches NIMT brand palette)
UPDATE public.departments SET color = '#0047FF' WHERE name = 'Management';
UPDATE public.departments SET color = '#0047FF' WHERE name = 'Computer Science';
UPDATE public.departments SET color = '#00C896' WHERE name = 'Nursing';
UPDATE public.departments SET color = '#00C896' WHERE name = 'Medical Sciences';
UPDATE public.departments SET color = '#C4641F' WHERE name = 'Law';
UPDATE public.departments SET color = '#7B61FF' WHERE name = 'Education';
UPDATE public.departments SET color = '#00B0D0' WHERE name = 'Pharmacy';

-- School departments
UPDATE public.departments SET color = '#0047FF' WHERE name IN ('School', 'Pre-Primary', 'Senior Secondary');
UPDATE public.departments SET color = '#059669' WHERE name IN ('Early Years Programme', 'Primary Years Programme');
