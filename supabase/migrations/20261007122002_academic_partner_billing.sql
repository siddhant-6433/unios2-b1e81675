-- academic partner billing
-- Academic partner receipt reconciliation, payout batches and Zoho bills.

ALTER TABLE public.academic_partners
  ADD COLUMN IF NOT EXISTS zoho_vendor_id text;

ALTER TABLE public.academic_partner_payouts
  ADD COLUMN IF NOT EXISTS zoho_bill_id text,
  ADD COLUMN IF NOT EXISTS zoho_bill_number text,
  ADD COLUMN IF NOT EXISTS zoho_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS zoho_sync_error text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS bill_id uuid;

CREATE TABLE IF NOT EXISTS public.academic_partner_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  payout_count integer NOT NULL DEFAULT 0 CHECK (payout_count >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'synced_to_zoho', 'cancelled')),
  created_by uuid REFERENCES public.profiles(id),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  zoho_bill_id text,
  zoho_bill_number text,
  zoho_synced_at timestamptz,
  zoho_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

ALTER TABLE public.academic_partner_payouts
  -- lint-allow: production-applied historical migration restored from schema_migrations.
  ADD CONSTRAINT academic_partner_payouts_bill_id_fkey
  FOREIGN KEY (bill_id) REFERENCES public.academic_partner_bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_academic_partner_bills_partner_period
  ON public.academic_partner_bills(partner_id, period_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_partner_bills_active_period
  ON public.academic_partner_bills(partner_id, period_start, period_end)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_academic_partner_payouts_bill
  ON public.academic_partner_payouts(bill_id) WHERE bill_id IS NOT NULL;

ALTER TABLE public.academic_partner_bills ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.academic_partner_bills TO authenticated;

-- lint-allow: production-applied historical migration restored from schema_migrations.
CREATE POLICY "Admins manage academic partner bills"
  ON public.academic_partner_bills FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
  );

-- lint-allow: production-applied historical migration restored from schema_migrations.
CREATE POLICY "Academic partners read own bills"
  ON public.academic_partner_bills FOR SELECT TO authenticated
  USING (partner_id IN (SELECT id FROM public.academic_partners WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.create_academic_partner_bill(
  _partner_id uuid,
  _period_start date,
  _period_end date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bill_id uuid;
  v_amount numeric(12,2);
  v_count integer;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid, 'super_admin'::public.app_role)
    OR public.has_role(v_uid, 'campus_admin'::public.app_role)
    OR public.has_role(v_uid, 'admission_head'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only authorised finance staff can create partner bills';
  END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start THEN
    RAISE EXCEPTION 'A valid bill period is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.academic_partners WHERE id = _partner_id AND status = 'active') THEN
    RAISE EXCEPTION 'Active academic partner not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_partner_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.academic_partner_bills
    WHERE partner_id = _partner_id AND status <> 'cancelled'
      AND period_start <= _period_end AND period_end >= _period_start
  ) THEN
    RAISE EXCEPTION 'A bill already covers part of this partner period';
  END IF;

  -- One payout row per eligible confirmed receipt. The most specific active
  -- course/batch assignment wins; an unbatched assignment is the fallback.
  INSERT INTO public.academic_partner_payouts (
    partner_id, lead_id, student_id, lead_payment_id, course_id, batch_id,
    payout_percentage, fee_paid, payout_amount, status, notes
  )
  SELECT
    _partner_id, lp.lead_id, student.id, lp.id, l.course_id, student.batch_id,
    assignment.payout_percentage, lp.amount,
    round(lp.amount * assignment.payout_percentage / 100.0, 2), 'pending',
    'Calculated from confirmed receipt using the active course/batch assignment rate.'
  FROM public.lead_payments lp
  JOIN public.leads l ON l.id = lp.lead_id AND l.academic_partner_id = _partner_id
  LEFT JOIN LATERAL (
    SELECT s.id, s.batch_id
    FROM public.students s
    WHERE s.lead_id = l.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) student ON true
  JOIN LATERAL (
    SELECT COALESCE(apa.payout_percentage, ap.default_payout_percentage) AS payout_percentage
    FROM public.academic_partner_assignments apa
    JOIN public.academic_partners ap ON ap.id = apa.partner_id
    WHERE apa.partner_id = _partner_id
      AND apa.is_active = true
      AND apa.course_id = l.course_id
      AND (apa.batch_id IS NULL OR apa.batch_id = student.batch_id)
    ORDER BY (apa.batch_id IS NULL) ASC, apa.updated_at DESC
    LIMIT 1
  ) assignment ON assignment.payout_percentage > 0
  WHERE lp.status = 'confirmed'
    AND (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _period_start AND _period_end
    AND NOT EXISTS (
      SELECT 1 FROM public.academic_partner_payouts existing
      WHERE existing.lead_payment_id = lp.id AND existing.status <> 'cancelled'
    );

  SELECT COALESCE(SUM(payout_amount), 0), COUNT(*)
    INTO v_amount, v_count
  FROM public.academic_partner_payouts
  WHERE partner_id = _partner_id
    AND status = 'pending'
    AND bill_id IS NULL
    AND lead_payment_id IN (
      SELECT lp.id FROM public.lead_payments lp
      WHERE lp.status = 'confirmed'
        AND (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _period_start AND _period_end
    );
  IF v_count = 0 OR v_amount <= 0 THEN
    RAISE EXCEPTION 'No unbilled confirmed receipts with an active payout rate in this period';
  END IF;

  INSERT INTO public.academic_partner_bills (
    partner_id, period_start, period_end, amount, payout_count, created_by
  ) VALUES (_partner_id, _period_start, _period_end, v_amount, v_count, v_uid)
  RETURNING id INTO v_bill_id;

  UPDATE public.academic_partner_payouts
  SET bill_id = v_bill_id
  WHERE partner_id = _partner_id
    AND status = 'pending'
    AND bill_id IS NULL
    AND lead_payment_id IN (
      SELECT lp.id FROM public.lead_payments lp
      WHERE lp.status = 'confirmed'
        AND (lp.payment_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _period_start AND _period_end
    );
  RETURN v_bill_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_academic_partner_bill(_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid, 'super_admin'::public.app_role)
    OR public.has_role(v_uid, 'campus_admin'::public.app_role)
    OR public.has_role(v_uid, 'admission_head'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Only authorised finance staff can approve partner bills';
  END IF;
  UPDATE public.academic_partner_bills
  SET status = 'approved', approved_by = v_uid, approved_at = now(), zoho_sync_error = NULL
  WHERE id = _bill_id AND status = 'draft'
  RETURNING partner_id INTO v_partner_id;
  IF v_partner_id IS NULL THEN RAISE EXCEPTION 'Draft partner bill not found'; END IF;
  UPDATE public.academic_partner_payouts
  SET status = 'approved', approved_by = v_uid, approved_at = now()
  WHERE bill_id = _bill_id AND status = 'pending';
  RETURN _bill_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_academic_partner_bill(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_academic_partner_bill(uuid) TO authenticated;
