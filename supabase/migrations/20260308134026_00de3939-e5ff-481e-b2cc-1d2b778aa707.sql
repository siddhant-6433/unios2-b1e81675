
-- Table to store pending WhatsApp OTPs
CREATE TABLE public.whatsapp_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX idx_whatsapp_otps_phone ON public.whatsapp_otps (phone, verified);

-- RLS: only edge functions (service role) access this table
ALTER TABLE public.whatsapp_otps ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup old OTPs (function + trigger)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.whatsapp_otps WHERE expires_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_otps
AFTER INSERT ON public.whatsapp_otps
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_expired_otps();
