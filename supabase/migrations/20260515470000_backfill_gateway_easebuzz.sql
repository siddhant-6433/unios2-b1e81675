-- Backfill: every gateway-mode payment that pre-dates the gateway column
-- was processed via Easebuzz (ICICI integration is brand-new). Stamp them.
UPDATE public.lead_payments
   SET gateway = 'easebuzz'
 WHERE gateway IS NULL
   AND payment_mode IN ('gateway', 'online');
