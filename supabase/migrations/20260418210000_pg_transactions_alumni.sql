-- Central payment transactions table for all payment types
CREATE TABLE IF NOT EXISTS public.pg_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id text NOT NULL,
  context text NOT NULL CHECK (context IN ('application_fee', 'alumni_service', 'student_fee')),
  context_id text, -- application_id or alumni request id
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'success', 'failed', 'pending')),
  gateway text, -- 'easebuzz' or 'cashfree'
  gateway_ref text, -- easepayid or cashfree order_id
  payer_name text,
  payer_email text,
  payer_phone text,
  product_info text,
  raw_response jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pg_txn_context ON public.pg_transactions(context, context_id);
CREATE INDEX idx_pg_txn_status ON public.pg_transactions(status);

ALTER TABLE public.pg_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can insert pg_transactions" ON public.pg_transactions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can read own pg_transactions" ON public.pg_transactions FOR SELECT TO anon USING (true);
CREATE POLICY "Auth can read pg_transactions" ON public.pg_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can insert pg_transactions" ON public.pg_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service can manage pg_transactions" ON public.pg_transactions FOR ALL TO service_role USING (true);

GRANT SELECT, INSERT, UPDATE ON public.pg_transactions TO anon;
GRANT ALL ON public.pg_transactions TO authenticated, service_role;
