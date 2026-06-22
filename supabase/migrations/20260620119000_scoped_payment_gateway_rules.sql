-- Context + organisation scoped payment gateway routing.
--
-- payment_gateway_config remains the gateway catalog. This table controls
-- where each gateway is usable: by payment context and optional organisation
-- scope. Resolution order is implemented in the app:
-- institution > campus > institution_group > institution_type > global.

ALTER TABLE public.payment_gateway_config
  ADD COLUMN IF NOT EXISTS supports_application_fee boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_token_fee boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_student_fee boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supports_alumni_service boolean NOT NULL DEFAULT false;

INSERT INTO public.payment_gateway_config (
  gateway,
  display_name,
  is_enabled_fee_collection,
  is_enabled_portal_payment,
  supports_application_fee,
  supports_token_fee,
  supports_student_fee,
  supports_alumni_service
) VALUES
  ('cashfree', 'Cashfree Payments', true, true, true, false, true, false),
  ('razorpay', 'Razorpay', true, true, true, true, true, true),
  ('easebuzz', 'EaseBuzz', true, true, true, true, true, true),
  ('icici', 'ICICI Bank PG', true, true, true, true, true, true)
ON CONFLICT (gateway) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  supports_application_fee = EXCLUDED.supports_application_fee,
  supports_token_fee = EXCLUDED.supports_token_fee,
  supports_student_fee = EXCLUDED.supports_student_fee,
  supports_alumni_service = EXCLUDED.supports_alumni_service;

CREATE TABLE IF NOT EXISTS public.payment_gateway_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_context text NOT NULL CHECK (
    payment_context IN ('application_fee', 'token_fee', 'student_fee', 'alumni_service')
  ),
  scope_type text NOT NULL CHECK (
    scope_type IN ('global', 'institution_group', 'campus', 'institution', 'institution_type')
  ),
  scope_id text,
  gateway text NOT NULL REFERENCES public.payment_gateway_config(gateway) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  is_staff_pilot_only boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_gateway_rules_scope_shape CHECK (
    (scope_type = 'global' AND scope_id IS NULL)
    OR (scope_type = 'institution_type' AND scope_id IN ('school', 'college'))
    OR (scope_type IN ('institution_group', 'campus', 'institution') AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_gateway_rules_scope
  ON public.payment_gateway_rules (
    payment_context,
    scope_type,
    COALESCE(scope_id, '__global__'),
    gateway
  );

CREATE INDEX IF NOT EXISTS idx_payment_gateway_rules_lookup
  ON public.payment_gateway_rules (payment_context, scope_type, scope_id, is_enabled, priority);

ALTER TABLE public.payment_gateway_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_payment_gateway_rules ON public.payment_gateway_rules;
CREATE POLICY read_payment_gateway_rules
  ON public.payment_gateway_rules FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS superadmin_write_payment_gateway_rules ON public.payment_gateway_rules;
CREATE POLICY superadmin_write_payment_gateway_rules
  ON public.payment_gateway_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

GRANT SELECT ON public.payment_gateway_rules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payment_gateway_rules TO authenticated;

CREATE OR REPLACE FUNCTION public.set_payment_gateway_rules_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_gateway_rules_updated_at ON public.payment_gateway_rules;
CREATE TRIGGER trg_payment_gateway_rules_updated_at
  BEFORE UPDATE ON public.payment_gateway_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_gateway_rules_updated_at();

-- Global defaults: Razorpay is first, ICICI second, EaseBuzz third.
INSERT INTO public.payment_gateway_rules (
  payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority
)
SELECT ctx, 'global', NULL, 'razorpay', true, false, 10
FROM unnest(ARRAY['application_fee', 'token_fee', 'student_fee', 'alumni_service']) AS ctx
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'razorpay'
);

INSERT INTO public.payment_gateway_rules (
  payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority
)
SELECT ctx, 'global', NULL, 'easebuzz', true, false, 30
FROM unnest(ARRAY['application_fee', 'token_fee', 'student_fee', 'alumni_service']) AS ctx
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'easebuzz'
);

-- Cashfree has app-fee and student-fee support in this codebase.
INSERT INTO public.payment_gateway_rules (
  payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority
)
SELECT ctx, 'global', NULL, 'cashfree', true, false, 40
FROM unnest(ARRAY['application_fee', 'student_fee']) AS ctx
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'cashfree'
);

INSERT INTO public.payment_gateway_rules (
  payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority
)
SELECT ctx, 'global', NULL, 'icici', true, false, 20
FROM unnest(ARRAY['application_fee', 'token_fee', 'student_fee', 'alumni_service']) AS ctx
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'icici'
);
