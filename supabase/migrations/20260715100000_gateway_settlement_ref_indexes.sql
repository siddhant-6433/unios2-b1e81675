-- Broaden confirmed gateway payment_ref uniqueness for Easebuzz + ICICI shapes.
-- Razorpay pay_ / plink_ already covered by 20260714160000.
--
-- Easebuzz easepayid often looks like E26071412E2V1P
-- ICICI merchant txn: ICxxxx / Fxxxx; bank txnID often long numeric
-- Manual marks: MANUAL_...

DROP INDEX IF EXISTS public.lead_payments_confirmed_gateway_ref_uidx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.lead_payments
     WHERE status = 'confirmed'
       AND transaction_ref IS NOT NULL
       AND (
         transaction_ref ~ '^(pay_|plink_|E[0-9]|IC|MANUAL_)'
         OR transaction_ref ~ '^[0-9]{10,}$'
       )
     GROUP BY transaction_ref
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX lead_payments_confirmed_gateway_ref_uidx
      ON public.lead_payments (transaction_ref)
      WHERE status = 'confirmed'
        AND transaction_ref IS NOT NULL
        AND (
          transaction_ref ~ '^(pay_|plink_|E[0-9]|IC|MANUAL_)'
          OR transaction_ref ~ '^[0-9]{10,}$'
        );
  ELSE
    RAISE NOTICE 'Skipping broadened lead_payments gateway ref unique index — duplicates exist';
  END IF;
END $$;
