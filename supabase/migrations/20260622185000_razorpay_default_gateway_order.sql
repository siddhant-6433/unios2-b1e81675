-- Make Razorpay the default online gateway, followed by ICICI and EaseBuzz.

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
  ('razorpay', 'Razorpay', true, true, true, true, true, true),
  ('icici', 'ICICI Bank PG', true, true, true, true, true, true),
  ('easebuzz', 'EaseBuzz', true, true, true, true, true, true)
ON CONFLICT (gateway) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_enabled_fee_collection = EXCLUDED.is_enabled_fee_collection,
  is_enabled_portal_payment = EXCLUDED.is_enabled_portal_payment,
  supports_application_fee = EXCLUDED.supports_application_fee,
  supports_token_fee = EXCLUDED.supports_token_fee,
  supports_student_fee = EXCLUDED.supports_student_fee,
  supports_alumni_service = EXCLUDED.supports_alumni_service;

INSERT INTO public.payment_gateway_rules (
  payment_context,
  scope_type,
  scope_id,
  gateway,
  is_enabled,
  is_staff_pilot_only,
  priority
)
SELECT ctx, 'global', NULL, 'razorpay', true, false, 10
FROM unnest(ARRAY['application_fee', 'token_fee', 'student_fee', 'alumni_service']) AS ctx
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'razorpay'
);

INSERT INTO public.payment_gateway_rules (
  payment_context,
  scope_type,
  scope_id,
  gateway,
  is_enabled,
  is_staff_pilot_only,
  priority
)
SELECT DISTINCT r.payment_context, r.scope_type, r.scope_id, 'razorpay', true, false, 10
FROM public.payment_gateway_rules r
WHERE r.gateway IN ('icici', 'easebuzz', 'cashfree')
  AND NOT EXISTS (
    SELECT 1
    FROM public.payment_gateway_rules existing
    WHERE existing.payment_context = r.payment_context
      AND existing.scope_type = r.scope_type
      AND COALESCE(existing.scope_id, '__global__') = COALESCE(r.scope_id, '__global__')
      AND existing.gateway = 'razorpay'
  );

UPDATE public.payment_gateway_rules
SET priority = 10,
    is_enabled = true,
    is_staff_pilot_only = false
WHERE gateway = 'razorpay'
  AND payment_context IN ('application_fee', 'token_fee', 'student_fee', 'alumni_service');

UPDATE public.payment_gateway_rules
SET priority = 20,
    is_enabled = true,
    is_staff_pilot_only = false
WHERE gateway = 'icici'
  AND payment_context IN ('application_fee', 'token_fee', 'student_fee', 'alumni_service');

UPDATE public.payment_gateway_rules
SET priority = 30,
    is_enabled = true,
    is_staff_pilot_only = false
WHERE gateway = 'easebuzz'
  AND payment_context IN ('application_fee', 'token_fee', 'student_fee', 'alumni_service');
