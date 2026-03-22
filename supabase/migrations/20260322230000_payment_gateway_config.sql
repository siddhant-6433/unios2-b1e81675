-- Payment gateway configuration table
CREATE TABLE IF NOT EXISTS public.payment_gateway_config (
  gateway               text PRIMARY KEY,           -- 'cashfree' | 'easebuzz'
  display_name          text NOT NULL,
  is_enabled_fee_collection  boolean NOT NULL DEFAULT true,
  is_enabled_portal_payment  boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_gateway_config ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (frontend needs this to decide which SDK to load)
CREATE POLICY "read_payment_gateway_config"
  ON public.payment_gateway_config FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only super_admin can modify
CREATE POLICY "superadmin_write_payment_gateway_config"
  ON public.payment_gateway_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

GRANT SELECT ON public.payment_gateway_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payment_gateway_config TO authenticated;

-- Seed initial gateways
INSERT INTO public.payment_gateway_config (gateway, display_name, is_enabled_fee_collection, is_enabled_portal_payment)
VALUES
  ('cashfree',  'Cashfree Payments', true, true),
  ('easebuzz',  'EaseBuzz',          true, true)
ON CONFLICT (gateway) DO NOTHING;
