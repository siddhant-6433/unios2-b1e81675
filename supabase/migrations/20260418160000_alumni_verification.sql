-- Alumni Verification Module

-- 1. Main table
CREATE TABLE public.alumni_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','under_review','verified','rejected')),

  -- Requestor (employer/third-party company)
  requestor_phone text NOT NULL,
  contact_name text NOT NULL,
  contact_phone_spoc text NOT NULL,
  employer_name text NOT NULL,

  -- Alumni/student info to verify
  alumni_name text NOT NULL,
  course text NOT NULL,
  year_of_passing integer NOT NULL,

  -- Document uploads (storage paths)
  diploma_certificate_url text,
  marksheet_urls text[] DEFAULT '{}',
  additional_doc_urls text[] DEFAULT '{}',

  -- Payment
  fee_amount numeric NOT NULL DEFAULT 500,
  payment_ref text,
  payment_method text,
  paid_at timestamptz,

  -- Verification result
  reviewed_by uuid REFERENCES auth.users(id),
  review_notes text,
  verification_result text CHECK (verification_result IN ('confirmed','not_found','discrepancy')),
  reviewed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.alumni_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.alumni_verification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert" ON public.alumni_verification_requests
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can read by phone" ON public.alumni_verification_requests
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can update pending_payment" ON public.alumni_verification_requests
  FOR UPDATE TO anon USING (status = 'pending_payment');

CREATE POLICY "Auth can read all" ON public.alumni_verification_requests
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth can update" ON public.alumni_verification_requests
  FOR UPDATE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE ON public.alumni_verification_requests TO anon;
GRANT ALL ON public.alumni_verification_requests TO authenticated, service_role;

-- Auto-generate request number (AVR-00001)
CREATE OR REPLACE FUNCTION public.generate_avr_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.request_number := 'AVR-' || LPAD(
    nextval(pg_get_serial_sequence('alumni_verification_requests', 'id')::text)::text, 5, '0');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.request_number := 'AVR-' || LPAD(
    (SELECT COUNT(*) + 1 FROM public.alumni_verification_requests)::text, 5, '0');
  RETURN NEW;
END;
$$;

-- Simpler approach: use a sequence
CREATE SEQUENCE IF NOT EXISTS public.avr_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_avr_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.request_number := 'AVR-' || LPAD(nextval('public.avr_seq')::text, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_avr_number
  BEFORE INSERT ON public.alumni_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.generate_avr_number();

-- 2. Storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('alumni-verification-docs', 'alumni-verification-docs', false)
ON CONFLICT DO NOTHING;

CREATE POLICY "Anon upload alumni docs" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'alumni-verification-docs');

CREATE POLICY "Anon read own alumni docs" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'alumni-verification-docs');

CREATE POLICY "Auth read alumni docs" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'alumni-verification-docs');

-- 3. Permissions
INSERT INTO public.permissions (module, action, description) VALUES
  ('alumni_verification', 'view', 'View alumni verification requests'),
  ('alumni_verification', 'manage', 'Review and update alumni verification requests')
ON CONFLICT (module, action) DO NOTHING;

-- Grant to admin roles
DO $$
DECLARE v_perm_id uuid;
BEGIN
  FOR v_perm_id IN SELECT id FROM permissions WHERE module = 'alumni_verification' LOOP
    INSERT INTO role_permissions (role, permission_id)
    VALUES ('super_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    INSERT INTO role_permissions (role, permission_id)
    VALUES ('campus_admin'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
    INSERT INTO role_permissions (role, permission_id)
    VALUES ('principal'::app_role, v_perm_id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 4. Index
CREATE INDEX idx_avr_status ON public.alumni_verification_requests(status);
CREATE INDEX idx_avr_phone ON public.alumni_verification_requests(requestor_phone);
