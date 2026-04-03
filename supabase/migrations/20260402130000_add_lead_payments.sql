-- Feature 4: Lead Payment Tracking & Reconciliation

CREATE TABLE public.lead_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('application_fee', 'token_fee', 'registration_fee', 'other')),
  amount numeric(10,2) NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'online', 'gateway')),
  transaction_ref text,
  receipt_no text,
  receipt_url text,
  status text DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'refunded')),
  payment_date timestamptz DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_lead_payments_lead ON public.lead_payments(lead_id);
CREATE INDEX idx_lead_payments_type ON public.lead_payments(type);

ALTER TABLE public.lead_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage lead_payments"
  ON public.lead_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Reconciliation summary view
CREATE OR REPLACE VIEW public.lead_payment_summary AS
SELECT
  l.id AS lead_id,
  l.name,
  l.phone,
  l.stage,
  l.course_id,
  l.campus_id,
  COALESCE(SUM(lp.amount) FILTER (WHERE lp.type = 'application_fee' AND lp.status = 'confirmed'), 0) AS application_fee_paid,
  COALESCE(SUM(lp.amount) FILTER (WHERE lp.type = 'token_fee' AND lp.status = 'confirmed'), 0) AS token_fee_paid,
  COALESCE(SUM(lp.amount) FILTER (WHERE lp.status = 'confirmed'), 0) AS total_paid,
  l.offer_amount,
  l.token_amount,
  CASE
    WHEN l.token_amount IS NOT NULL AND l.token_amount > 0
    THEN l.token_amount - COALESCE(SUM(lp.amount) FILTER (WHERE lp.type = 'token_fee' AND lp.status = 'confirmed'), 0)
    ELSE 0
  END AS token_balance
FROM public.leads l
LEFT JOIN public.lead_payments lp ON lp.lead_id = l.id
GROUP BY l.id, l.name, l.phone, l.stage, l.course_id, l.campus_id, l.offer_amount, l.token_amount;

GRANT SELECT ON public.lead_payment_summary TO authenticated;
