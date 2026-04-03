-- Course-wise consultant commissions + payout tracking

-- 1. Course-wise commission rates (replaces flat commission on consultants table)
CREATE TABLE public.consultant_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  commission_type text NOT NULL DEFAULT 'percentage' CHECK (commission_type IN ('percentage', 'fixed')),
  commission_value numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(consultant_id, course_id)
);

ALTER TABLE public.consultant_commissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_commissions TO authenticated;

CREATE POLICY "Staff can manage consultant_commissions"
  ON public.consultant_commissions FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
  );

CREATE POLICY "Consultants can view own commissions"
  ON public.consultant_commissions FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid()));

-- 2. Payout ledger — tracks commission payouts tied to student fee payments
CREATE TABLE public.consultant_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  course_id uuid REFERENCES public.courses(id),
  commission_type text NOT NULL,
  commission_value numeric(10,2) NOT NULL,
  student_fee_paid numeric(10,2) NOT NULL,
  annual_fee numeric(10,2) NOT NULL,
  fee_paid_pct numeric(5,2) NOT NULL,
  payout_amount numeric(10,2) NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
  approved_by uuid REFERENCES public.profiles(id),
  paid_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_consultant_payouts_consultant ON public.consultant_payouts(consultant_id);
CREATE INDEX idx_consultant_payouts_lead ON public.consultant_payouts(lead_id);

ALTER TABLE public.consultant_payouts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_payouts TO authenticated;

CREATE POLICY "Staff can manage consultant_payouts"
  ON public.consultant_payouts FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
  );

CREATE POLICY "Consultants can view own payouts"
  ON public.consultant_payouts FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid()));

-- 3. Allow consultants to insert lead_payments (for paying on behalf of students)
CREATE POLICY "Consultants can record payments for own leads"
  ON public.lead_payments FOR INSERT TO authenticated
  WITH CHECK (
    lead_id IN (
      SELECT l.id FROM public.leads l
      JOIN public.consultants c ON c.id = l.consultant_id
      WHERE c.user_id = auth.uid()
    )
  );

CREATE POLICY "Consultants can view payments for own leads"
  ON public.lead_payments FOR SELECT TO authenticated
  USING (
    lead_id IN (
      SELECT l.id FROM public.leads l
      JOIN public.consultants c ON c.id = l.consultant_id
      WHERE c.user_id = auth.uid()
    )
  );

-- 4. Updated consultant dashboard view with course-wise commission support
DROP VIEW IF EXISTS public.consultant_dashboard;
CREATE VIEW public.consultant_dashboard AS
SELECT
  c.id AS consultant_id,
  c.user_id,
  c.name AS consultant_name,
  c.phone AS consultant_phone,
  c.email AS consultant_email,
  c.commission_type AS default_commission_type,
  c.commission_value AS default_commission_value,
  COUNT(DISTINCT l.id) AS total_leads,
  COUNT(DISTINCT l.id) FILTER (WHERE l.stage = 'admitted') AS conversions,
  COUNT(DISTINCT l.id) FILTER (WHERE l.stage NOT IN ('rejected', 'admitted')) AS pipeline,
  COALESCE(SUM(lp_total.total_paid), 0)::numeric(12,2) AS total_fee_collected,
  COALESCE((SELECT SUM(cp.payout_amount) FROM public.consultant_payouts cp WHERE cp.consultant_id = c.id AND cp.status IN ('approved', 'paid')), 0)::numeric(12,2) AS total_commission,
  COALESCE((SELECT SUM(cp.payout_amount) FROM public.consultant_payouts cp WHERE cp.consultant_id = c.id AND cp.status = 'paid'), 0)::numeric(12,2) AS commission_paid,
  COALESCE((SELECT SUM(cp.payout_amount) FROM public.consultant_payouts cp WHERE cp.consultant_id = c.id AND cp.status IN ('pending', 'approved')), 0)::numeric(12,2) AS commission_pending
FROM public.consultants c
LEFT JOIN public.leads l ON l.consultant_id = c.id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(lp.amount) FILTER (WHERE lp.status = 'confirmed'), 0) AS total_paid
  FROM public.lead_payments lp WHERE lp.lead_id = l.id
) lp_total ON true
GROUP BY c.id;

GRANT SELECT ON public.consultant_dashboard TO authenticated;
