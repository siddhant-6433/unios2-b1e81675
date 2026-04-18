-- Fix: grant sequence usage to anon for request number generation
GRANT USAGE, SELECT ON SEQUENCE public.avr_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.avr_seq TO authenticated;

-- Add missing columns
ALTER TABLE public.alumni_verification_requests ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.alumni_verification_requests ADD COLUMN IF NOT EXISTS third_party_company text;
