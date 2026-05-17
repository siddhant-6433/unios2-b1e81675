-- Short-lived browser intents for "Continue with WhatsApp".
--
-- The browser receives (id, client_secret). WhatsApp receives only the short
-- code in the prefilled message. Polling requires the client secret, so a
-- random WhatsApp sender cannot claim an intent they did not start.

CREATE TABLE public.whatsapp_login_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  client_secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'consumed', 'expired', 'failed')),
  sender_phone text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text,
  error text,
  business_phone_number_id text,
  wa_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz
);

CREATE INDEX idx_whatsapp_login_intents_code_pending
  ON public.whatsapp_login_intents (code)
  WHERE status = 'pending';

CREATE INDEX idx_whatsapp_login_intents_expires
  ON public.whatsapp_login_intents (expires_at);

ALTER TABLE public.whatsapp_login_intents ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.whatsapp_login_intents TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_whatsapp_login_intents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.whatsapp_login_intents
     SET status = 'expired',
         error = COALESCE(error, 'Login request expired')
   WHERE status = 'pending'
     AND expires_at < now();

  DELETE FROM public.whatsapp_login_intents
   WHERE created_at < now() - interval '24 hours';

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_whatsapp_login_intents
AFTER INSERT ON public.whatsapp_login_intents
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_expired_whatsapp_login_intents();
