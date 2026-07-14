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
  ('razorpay', 'Razorpay', true, true, true, true, true, false)
ON CONFLICT (gateway) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_enabled_fee_collection = EXCLUDED.is_enabled_fee_collection,
  is_enabled_portal_payment = EXCLUDED.is_enabled_portal_payment,
  supports_application_fee = EXCLUDED.supports_application_fee,
  supports_token_fee = EXCLUDED.supports_token_fee,
  supports_student_fee = EXCLUDED.supports_student_fee,
  supports_alumni_service = EXCLUDED.supports_alumni_service;

INSERT INTO public.payment_gateway_rules (
  payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority
)
SELECT ctx, 'global', NULL, 'razorpay', true, false, 10
FROM unnest(ARRAY['application_fee', 'token_fee', 'student_fee']) AS ctx
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_gateway_rules r
  WHERE r.payment_context = ctx
    AND r.scope_type = 'global'
    AND r.scope_id IS NULL
    AND r.gateway = 'razorpay'
);
