-- New default gateway order: EaseBuzz first, then Razorpay, then ICICI.
-- Supersedes 20260625150000 (which put Razorpay first). Update existing
-- scoped-rule priorities in place so the resolver picks EaseBuzz by default.

UPDATE public.payment_gateway_rules
   SET priority = CASE gateway
     WHEN 'easebuzz' THEN 10
     WHEN 'razorpay' THEN 20
     WHEN 'icici'    THEN 30
     WHEN 'cashfree' THEN 40
     ELSE priority
   END
 WHERE gateway IN ('easebuzz', 'razorpay', 'icici', 'cashfree');
