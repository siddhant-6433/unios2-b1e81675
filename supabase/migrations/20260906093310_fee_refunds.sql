-- Fee refunds: refund collected money against specific receipts / fee heads.
--
-- Mirrors the video_bills payout lifecycle (draft -> approved -> paid, Zoho refs)
-- but retargeted at a student's fee allocations. Each refund line points at a
-- fee_ledger_payments row (= "Rs X of receipt/lead_payment P was applied to fee
-- head L"), capped at that row's collected amount minus what's already been
-- refunded against it. On paid, a trigger decrements fee_ledger.paid_amount and
-- recomputes the head status.
--
-- Deliberately NOT touched: fee_ledger_payments rows and lead_payments stay
-- immutable. provision_student_fees derives its budget from
-- SUM(fee_ledger_payments.amount) (not paid_amount) since the 2026-09-01 fix, so
-- budget = confirmed - flp_sum is invariant under a refund (both untouched) and
-- refunded money is never re-applied. flp.amount stays the refund ceiling.

-- 1. Permission: finance:refund (copy the fee_ledger:reallocate pattern) -------
INSERT INTO public.permissions (module, action, description)
VALUES ('finance', 'refund', 'Create, approve and pay student fee refunds')
ON CONFLICT (module, action) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'accountant'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'finance' AND p.action = 'refund'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'super_admin'::public.app_role, p.id FROM public.permissions p
 WHERE p.module = 'finance' AND p.action = 'refund'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_manage_fee_refund(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user, 'super_admin')
      OR public.has_role(_user, 'accountant')
      OR 'finance:refund' = ANY (public.get_user_permissions(_user));
$function$;
GRANT EXECUTE ON FUNCTION public.can_manage_fee_refund(uuid) TO authenticated, service_role;

-- 2. Tables -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fee_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','rejected')),
  -- payee bank (entered inline; shared verification column convention)
  bank_account_name text,
  bank_account_number text,
  bank_ifsc text,
  bank_name text,
  bank_upi text,
  bank_verified_name text,
  bank_verified_at timestamptz,
  bank_verification_ref text,
  bank_verification_status text NOT NULL DEFAULT 'unverified',
  proof_url text,                     -- cancelled cheque / passbook
  notes text,                         -- admission_no + description, carried to Zoho
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  -- Zoho Books refs (Bill under "Refund" category + vendor payment)
  zoho_bill_id text,
  zoho_bill_number text,
  zoho_payment_id text,
  zoho_synced_at timestamptz,
  zoho_sync_error text
);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_student ON public.fee_refunds(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_refunds_status ON public.fee_refunds(status);

CREATE TABLE IF NOT EXISTS public.fee_refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.fee_refunds(id) ON DELETE CASCADE,
  fee_ledger_payment_id uuid NOT NULL REFERENCES public.fee_ledger_payments(id) ON DELETE RESTRICT,
  fee_ledger_id uuid NOT NULL REFERENCES public.fee_ledger(id) ON DELETE RESTRICT,
  lead_payment_id uuid REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_refund_items_refund ON public.fee_refund_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_fee_refund_items_flp ON public.fee_refund_items(fee_ledger_payment_id);

-- 3. RLS: super_admin full; finance:refund managers full; finance staff read ---
ALTER TABLE public.fee_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_refund_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fee_refunds_manage ON public.fee_refunds;
CREATE POLICY fee_refunds_manage ON public.fee_refunds FOR ALL TO authenticated
  USING (public.can_manage_fee_refund(auth.uid()))
  WITH CHECK (public.can_manage_fee_refund(auth.uid()));

DROP POLICY IF EXISTS fee_refunds_finance_read ON public.fee_refunds;
CREATE POLICY fee_refunds_finance_read ON public.fee_refunds FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'campus_admin') OR public.has_role(auth.uid(), 'principal'));

DROP POLICY IF EXISTS fee_refund_items_manage ON public.fee_refund_items;
CREATE POLICY fee_refund_items_manage ON public.fee_refund_items FOR ALL TO authenticated
  USING (public.can_manage_fee_refund(auth.uid()))
  WITH CHECK (public.can_manage_fee_refund(auth.uid()));

DROP POLICY IF EXISTS fee_refund_items_finance_read ON public.fee_refund_items;
CREATE POLICY fee_refund_items_finance_read ON public.fee_refund_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'campus_admin') OR public.has_role(auth.uid(), 'principal'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_refunds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_refund_items TO authenticated;
GRANT ALL ON public.fee_refunds TO service_role;
GRANT ALL ON public.fee_refund_items TO service_role;

-- 4. Picker read: refundable allocations for a student ------------------------
-- One row per fee_ledger_payments row, with the collected amount, how much has
-- already been refunded (non-rejected refunds), and the remaining refundable.
CREATE OR REPLACE FUNCTION public.get_refundable_allocations(_student_id uuid)
RETURNS TABLE (
  fee_ledger_payment_id uuid,
  fee_ledger_id uuid,
  lead_payment_id uuid,
  fee_code text,
  fee_head text,
  term text,
  receipt_no text,
  payment_date timestamptz,
  gateway text,
  payment_mode text,
  collected numeric,
  already_refunded numeric,
  remaining numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    flp.id,
    flp.fee_ledger_id,
    flp.lead_payment_id,
    fc.code,
    fc.name,
    fl.term,
    lp.receipt_no,
    lp.payment_date,
    lp.gateway,
    lp.payment_mode,
    flp.amount AS collected,
    COALESCE(r.refunded, 0) AS already_refunded,
    flp.amount - COALESCE(r.refunded, 0) AS remaining
  FROM public.fee_ledger_payments flp
  JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
  JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
  LEFT JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
  LEFT JOIN LATERAL (
    SELECT SUM(fri.amount) AS refunded
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = flp.id
       AND fr.status <> 'rejected'
  ) r ON true
  WHERE fl.student_id = _student_id
    AND public.can_manage_fee_refund(auth.uid())
    AND flp.amount - COALESCE(r.refunded, 0) > 0.009
  ORDER BY lp.payment_date NULLS LAST, fc.name, fl.term;
$function$;
GRANT EXECUTE ON FUNCTION public.get_refundable_allocations(uuid) TO authenticated, service_role;

-- 5. create_fee_refund: validates caps, inserts draft + items -----------------
-- _items: [{ fee_ledger_payment_id uuid, amount numeric }]
-- _bank : { account_name, account_number, ifsc, bank_name, upi,
--           verified_name, verified_at, verification_ref, verification_status }
CREATE OR REPLACE FUNCTION public.create_fee_refund(
  _student_id uuid,
  _reason text,
  _items jsonb,
  _bank jsonb DEFAULT '{}'::jsonb,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_refund_id uuid;
  v_lead uuid;
  v_total numeric := 0;
  v_item jsonb;
  v_flp_id uuid;
  v_amt numeric;
  v_flp RECORD;
  v_already numeric;
BEGIN
  IF NOT public.can_manage_fee_refund(v_actor) THEN
    RAISE EXCEPTION 'Not authorized to create fee refunds';
  END IF;
  IF COALESCE(NULLIF(btrim(_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'At least one refund line is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = _student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  SELECT lead_id INTO v_lead FROM public.students WHERE id = _student_id;

  INSERT INTO public.fee_refunds (
    student_id, lead_id, reason, status,
    bank_account_name, bank_account_number, bank_ifsc, bank_name, bank_upi,
    bank_verified_name, bank_verified_at, bank_verification_ref, bank_verification_status,
    proof_url, notes, created_by)
  VALUES (
    _student_id, v_lead, btrim(_reason), 'draft',
    _bank->>'account_name', _bank->>'account_number', _bank->>'ifsc', _bank->>'bank_name', _bank->>'upi',
    _bank->>'verified_name',
    NULLIF(_bank->>'verified_at','')::timestamptz,
    _bank->>'verification_ref',
    COALESCE(NULLIF(_bank->>'verification_status',''), 'unverified'),
    _proof_url, _notes, v_actor)
  RETURNING id INTO v_refund_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_flp_id := (v_item->>'fee_ledger_payment_id')::uuid;
    v_amt := COALESCE((v_item->>'amount')::numeric, 0);
    IF v_amt <= 0 THEN CONTINUE; END IF;

    -- Lock the allocation row, verify it belongs to this student, and cap.
    SELECT flp.id, flp.fee_ledger_id, flp.lead_payment_id, flp.amount, fl.student_id AS student_id
      INTO v_flp
      FROM public.fee_ledger_payments flp
      JOIN public.fee_ledger fl ON fl.id = flp.fee_ledger_id
     WHERE flp.id = v_flp_id
     FOR UPDATE OF flp;
    IF NOT FOUND THEN RAISE EXCEPTION 'Allocation % not found', v_flp_id; END IF;
    IF v_flp.student_id <> _student_id THEN
      RAISE EXCEPTION 'Allocation % does not belong to this student', v_flp_id;
    END IF;

    SELECT COALESCE(SUM(fri.amount), 0) INTO v_already
      FROM public.fee_refund_items fri
      JOIN public.fee_refunds fr ON fr.id = fri.refund_id
     WHERE fri.fee_ledger_payment_id = v_flp_id AND fr.status <> 'rejected';

    IF v_amt > v_flp.amount - v_already + 0.009 THEN
      RAISE EXCEPTION 'Refund % exceeds remaining refundable % on allocation %',
        v_amt, v_flp.amount - v_already, v_flp_id;
    END IF;

    INSERT INTO public.fee_refund_items
      (refund_id, fee_ledger_payment_id, fee_ledger_id, lead_payment_id, amount)
    VALUES (v_refund_id, v_flp_id, v_flp.fee_ledger_id, v_flp.lead_payment_id, v_amt);
    v_total := v_total + v_amt;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Refund total must be positive';
  END IF;
  UPDATE public.fee_refunds SET total_amount = v_total WHERE id = v_refund_id;
  RETURN v_refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_fee_refund(uuid, text, jsonb, jsonb, text, text) TO authenticated, service_role;

-- 6. approve / mark_paid / reject transitions --------------------------------
CREATE OR REPLACE FUNCTION public.approve_fee_refund(_refund_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT status INTO v_status FROM public.fee_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Only a draft refund can be approved (is %)', v_status; END IF;
  UPDATE public.fee_refunds
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = _refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_fee_refund(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_fee_refund(_refund_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT status INTO v_status FROM public.fee_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_status = 'paid' THEN RAISE EXCEPTION 'A paid refund cannot be rejected'; END IF;
  UPDATE public.fee_refunds SET status = 'rejected' WHERE id = _refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.reject_fee_refund(uuid) TO authenticated, service_role;

-- mark_paid only flips status; the ledger reversal lives in the trigger below so
-- the manual path and the Zoho webhook (which also sets status='paid') converge.
CREATE OR REPLACE FUNCTION public.mark_fee_refund_paid(_refund_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  IF NOT public.can_manage_fee_refund(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT status INTO v_status FROM public.fee_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  IF v_status = 'paid' THEN RETURN; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'Only an approved refund can be paid (is %)', v_status; END IF;
  UPDATE public.fee_refunds SET status = 'paid', paid_at = now() WHERE id = _refund_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.mark_fee_refund_paid(uuid) TO authenticated, service_role;

-- 7. On paid -> apply the ledger reversal, once ------------------------------
-- ponytail: decrements fee_ledger.paid_amount and reopens the head. If the
-- student happens to have unbooked credit, a later provision_student_fees run
-- may re-book that credit onto the reopened head -- financially sound (that
-- money is still the college's to allocate). Add a guard only if finance wants
-- refunded heads to stay unpaid regardless of standing credit.
CREATE OR REPLACE FUNCTION public.apply_fee_refund_on_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item RECORD;
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    FOR v_item IN
      SELECT fee_ledger_id, SUM(amount) AS amt
        FROM public.fee_refund_items
       WHERE refund_id = NEW.id
       GROUP BY fee_ledger_id
    LOOP
      UPDATE public.fee_ledger
         SET paid_amount = GREATEST(paid_amount - v_item.amt, 0),
             status = CASE
               WHEN (total_amount - concession - GREATEST(paid_amount - v_item.amt, 0)) <= 0 THEN 'paid'
               WHEN due_date < current_date THEN 'overdue'
               ELSE 'due' END,
             updated_at = now()
       WHERE id = v_item.fee_ledger_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.apply_fee_refund_on_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_apply_fee_refund_on_paid ON public.fee_refunds;
CREATE TRIGGER trg_apply_fee_refund_on_paid
  AFTER UPDATE OF status ON public.fee_refunds
  FOR EACH ROW EXECUTE FUNCTION public.apply_fee_refund_on_paid();
