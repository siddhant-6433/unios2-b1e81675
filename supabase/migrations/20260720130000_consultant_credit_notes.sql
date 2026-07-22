-- Consultant credit notes (super_admin only).
--
-- A credit note is a pool of credit tied to a consultant — money the institution
-- owes the consultant (e.g. a credit the consultant has provided) that a
-- super_admin can apply against student fee receipts WITHOUT cash changing hands.
-- Applying it records a normal (confirmed) lead_payments receipt so the student's
-- fee clears and a receipt issues, but the receipt is flagged
-- payment_mode = 'consultant_credit_note' so it is excluded from cash/collection
-- totals, and it draws down the credit note ("deduction in due to consultant").

-- 1. The credit note pool ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE RESTRICT,
  credit_note_no text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  issue_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  reason text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, credit_note_no)
);

-- 2. Each application of a credit note against a student fee receipt ----------
CREATE TABLE IF NOT EXISTS public.consultant_credit_note_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.consultant_credit_notes(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cn_applications_credit_note ON public.consultant_credit_note_applications(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_consultant_credit_notes_consultant ON public.consultant_credit_notes(consultant_id);

-- 3. Allow the new payment mode on lead_payments -----------------------------
ALTER TABLE public.lead_payments DROP CONSTRAINT IF EXISTS lead_payments_payment_mode_check;
ALTER TABLE public.lead_payments ADD CONSTRAINT lead_payments_payment_mode_check
  CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'online', 'gateway', 'consultant_credit_note'));

-- 4. RLS ---------------------------------------------------------------------
ALTER TABLE public.consultant_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_credit_note_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admin manage consultant credit notes"
  ON public.consultant_credit_notes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Consultants read own credit notes"
  ON public.consultant_credit_notes FOR SELECT TO authenticated
  USING (consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid()));

CREATE POLICY "Super admin manage consultant credit note applications"
  ON public.consultant_credit_note_applications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Consultants read own credit note applications"
  ON public.consultant_credit_note_applications FOR SELECT TO authenticated
  USING (credit_note_id IN (
    SELECT cn.id FROM public.consultant_credit_notes cn
    JOIN public.consultants c ON c.id = cn.consultant_id
    WHERE c.user_id = auth.uid()
  ));

-- 5. Per-note balance summary (open notes: amount, applied, remaining) --------
CREATE OR REPLACE VIEW public.consultant_credit_note_summary
WITH (security_invoker = true) AS
SELECT
  cn.id,
  cn.consultant_id,
  c.name AS consultant_name,
  cn.credit_note_no,
  cn.amount,
  cn.issue_date,
  cn.reason,
  cn.status,
  cn.created_at,
  COALESCE(app.applied, 0)::numeric(12,2) AS applied,
  (cn.amount - COALESCE(app.applied, 0))::numeric(12,2) AS remaining
FROM public.consultant_credit_notes cn
JOIN public.consultants c ON c.id = cn.consultant_id
LEFT JOIN (
  SELECT credit_note_id, SUM(amount) AS applied
  FROM public.consultant_credit_note_applications
  GROUP BY credit_note_id
) app ON app.credit_note_id = cn.id;

-- 6. Create a credit note (super_admin) --------------------------------------
CREATE OR REPLACE FUNCTION public.create_consultant_credit_note(
  _consultant_id uuid,
  _credit_note_no text,
  _amount numeric,
  _issue_date date DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_id uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can create consultant credit notes';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF _credit_note_no IS NULL OR btrim(_credit_note_no) = '' THEN
    RAISE EXCEPTION 'Credit note number is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants WHERE id = _consultant_id) THEN
    RAISE EXCEPTION 'Consultant not found';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.consultant_credit_notes (consultant_id, credit_note_no, amount, issue_date, reason, created_by)
  VALUES (_consultant_id, btrim(_credit_note_no), _amount,
          COALESCE(_issue_date, (now() AT TIME ZONE 'Asia/Kolkata')::date), _reason, v_profile_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_consultant_credit_note(uuid, text, numeric, date, text) TO authenticated;

-- 7. Apply a credit note against a student fee receipt (super_admin) ----------
CREATE OR REPLACE FUNCTION public.apply_consultant_credit_note_receipt(
  _credit_note_id uuid,
  _lead_id uuid,
  _amount numeric,
  _type text,
  _application_id text DEFAULT NULL,
  _payment_date timestamptz DEFAULT now(),
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_cn_amount numeric;
  v_status text;
  v_cn_no text;
  v_applied numeric;
  v_remaining numeric;
  v_payment_id uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can apply consultant credit notes';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF _type NOT IN ('application_fee', 'token_fee', 'registration_fee', 'pre_admission_token', 'other') THEN
    RAISE EXCEPTION 'Invalid fee type';
  END IF;

  -- Lock the note so concurrent applications can't overdraw it.
  SELECT amount, status, credit_note_no
    INTO v_cn_amount, v_status, v_cn_no
  FROM public.consultant_credit_notes
  WHERE id = _credit_note_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit note not found'; END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'Credit note is not open'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_applied
  FROM public.consultant_credit_note_applications
  WHERE credit_note_id = _credit_note_id;
  v_remaining := v_cn_amount - v_applied;
  IF _amount > v_remaining THEN
    RAISE EXCEPTION 'Amount % exceeds credit note remaining balance %', _amount, v_remaining;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = _lead_id) THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.lead_payments
    (lead_id, type, amount, payment_mode, status, recorded_by, payment_date, gateway, notes, application_id)
  VALUES
    (_lead_id, _type, _amount, 'consultant_credit_note', 'confirmed', v_profile_id, _payment_date, 'offline',
     btrim(COALESCE(_notes, '') || ' [Consultant credit note ' || v_cn_no || ']'),
     CASE WHEN _type = 'application_fee' THEN _application_id ELSE NULL END)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.consultant_credit_note_applications
    (credit_note_id, lead_id, lead_payment_id, amount, created_by)
  VALUES (_credit_note_id, _lead_id, v_payment_id, _amount, v_profile_id);

  RETURN jsonb_build_object(
    'status', 'applied',
    'lead_payment_id', v_payment_id,
    'remaining', (v_remaining - _amount)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.apply_consultant_credit_note_receipt(uuid, uuid, numeric, text, text, timestamptz, text) TO authenticated;

-- 8. Frontend reads these directly (RLS gates rows); writes go via the RPCs above.
GRANT SELECT ON public.consultant_credit_notes TO authenticated;
GRANT SELECT ON public.consultant_credit_note_applications TO authenticated;
GRANT SELECT ON public.consultant_credit_note_summary TO authenticated;
