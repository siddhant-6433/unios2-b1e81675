-- Razorpay should be the default gateway, with ICICI as the second preference
-- for users who can see staff-pilot gateways. The original scoped-rule seeds
-- left EaseBuzz ahead of Razorpay, so update existing defaults in place.

UPDATE public.payment_gateway_rules
   SET priority = CASE gateway
     WHEN 'razorpay' THEN 10
     WHEN 'icici'    THEN 20
     WHEN 'easebuzz' THEN 30
     WHEN 'cashfree' THEN 40
     ELSE priority
   END
 WHERE gateway IN ('razorpay', 'icici', 'easebuzz', 'cashfree');
