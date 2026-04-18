-- Add request_type and additional fields for marksheet/diploma/transcript requests

ALTER TABLE public.alumni_verification_requests
  ADD COLUMN IF NOT EXISTS request_type text DEFAULT 'verification'
    CHECK (request_type IN ('verification', 'marksheet', 'diploma', 'transcript')),
  ADD COLUMN IF NOT EXISTS copy_type text CHECK (copy_type IN ('original', 'duplicate')),
  ADD COLUMN IF NOT EXISTS enrollment_no text,
  ADD COLUMN IF NOT EXISTS campus text;

-- Update the request number prefix based on type via trigger
CREATE OR REPLACE FUNCTION public.generate_avr_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prefix text;
  v_num bigint;
BEGIN
  v_num := nextval('public.avr_seq');
  v_prefix := CASE COALESCE(NEW.request_type, 'verification')
    WHEN 'verification' THEN 'AVR'
    WHEN 'marksheet' THEN 'AMR'
    WHEN 'diploma' THEN 'ADR'
    WHEN 'transcript' THEN 'ATR'
    ELSE 'AVR'
  END;
  NEW.request_number := v_prefix || '-' || LPAD(v_num::text, 5, '0');
  RETURN NEW;
END;
$$;
