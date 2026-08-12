-- ====================================================================
-- Edit / reduce / remove a per-row fee concession, with an audit trail.
--
-- Until now the Finance "+" could only ADD a concession (request_fee_concession
-- + super-admin decide_fee_concession). There was no way to correct or undo one.
--
-- Direction rules (a smaller discount = more money collected = the safe way):
--   * REDUCE or REMOVE a concession — super_admin, accountant AND counsellor,
--     applied immediately. It only ever increases what the student owes.
--   * INCREASE a concession — super_admin only (same gate as decide_fee_concession).
--     A non-super-admin who needs a bigger waiver raises a fresh request via
--     request_fee_concession, which still goes for approval.
--
-- Both actions funnel through the canonical sync_fee_ledger_concessions(), which
-- rebuilds fee_ledger.concession from source, so an offer-waiver share sitting on
-- the same row is never clobbered. Every action writes a concession_audit row.
-- ====================================================================

-- ────────── audit trail ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concession_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id  uuid,                 -- may outlive the concession row
  student_id     uuid,
  fee_ledger_id  uuid,
  action         text NOT NULL CHECK (action IN ('edit','remove')),
  old_type       text,
  old_value      numeric(12,2),
  new_type       text,
  new_value      numeric(12,2),
  old_amount     numeric(12,2),        -- effective ₹ before
  new_amount     numeric(12,2),        -- effective ₹ after (0 for remove)
  reason         text,
  actor_user_id  uuid,
  actor_role     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_concession_audit_student
  ON public.concession_audit(student_id, created_at DESC);

ALTER TABLE public.concession_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads concession audit" ON public.concession_audit;
CREATE POLICY "finance reads concession audit" ON public.concession_audit
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'campus_admin') OR public.has_role(auth.uid(),'principal')
    OR public.has_role(auth.uid(),'counsellor'));
GRANT SELECT ON public.concession_audit TO authenticated;
GRANT ALL    ON public.concession_audit TO service_role;

-- Effective ₹ of a concession against its ledger row (flat = value, pct = % of total).
CREATE OR REPLACE FUNCTION public.concession_effective_amount(
  _type text, _value numeric, _total numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _type = 'flat' THEN _value
              ELSE round(COALESCE(_total,0) * _value / 100, 2) END;
$$;

-- ────────── edit / reduce a concession ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.edit_fee_concession(
  _id    uuid,
  _type  text,
  _value numeric,
  _reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_new_amount numeric;
  v_super      boolean;
  v_role       text;
BEGIN
  v_super := public.has_role(auth.uid(), 'super_admin');
  IF NOT (v_super
       OR public.has_role(auth.uid(), 'accountant')
       OR public.has_role(auth.uid(), 'counsellor')) THEN
    RAISE EXCEPTION 'Not authorised to edit a concession';
  END IF;

  IF _type NOT IN ('flat', 'percentage') THEN
    RAISE EXCEPTION 'Concession type must be flat or percentage';
  END IF;
  IF _value IS NULL OR _value <= 0 THEN
    RAISE EXCEPTION 'Concession value must be greater than zero (use remove instead)';
  END IF;
  IF _type = 'percentage' AND _value > 100 THEN
    RAISE EXCEPTION 'Percentage concession cannot exceed 100';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN
    RAISE EXCEPTION 'This concession has already been removed';
  END IF;

  SELECT total_amount INTO v_total FROM public.fee_ledger WHERE id = c.fee_ledger_id;
  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  v_new_amount := public.concession_effective_amount(_type, _value, v_total);

  -- Increasing the discount is a super-admin-only act.
  IF v_new_amount > v_old_amount AND NOT v_super THEN
    RAISE EXCEPTION 'Only a super admin can increase a waiver. Reduce it, or raise a new request for approval.';
  END IF;

  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.concessions
     SET type   = _type,
         value  = _value,
         reason = btrim(_reason)
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'edit',
     c.type, c.value, _type, _value, v_old_amount, v_new_amount,
     btrim(_reason), auth.uid(), v_role);

  PERFORM public.sync_fee_ledger_concessions(c.student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_fee_concession(uuid, text, numeric, text)
  TO authenticated, service_role;

-- ────────── remove a concession ────────────────────────────────────────
-- Removal only ever raises what the student owes, so cashier/counsellor may do
-- it directly. Marks the row rejected (excluded by the sync) rather than deleting,
-- keeping requested_by / approval history intact.
CREATE OR REPLACE FUNCTION public.remove_fee_concession(
  _id     uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c            record;
  v_total      numeric;
  v_old_amount numeric;
  v_role       text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'accountant')
       OR public.has_role(auth.uid(), 'counsellor')) THEN
    RAISE EXCEPTION 'Not authorised to remove a concession';
  END IF;

  SELECT * INTO c FROM public.concessions WHERE id = _id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Concession not found'; END IF;
  IF c.status = 'rejected' THEN RETURN; END IF;  -- already gone; idempotent

  SELECT total_amount INTO v_total FROM public.fee_ledger WHERE id = c.fee_ledger_id;
  v_old_amount := public.concession_effective_amount(c.type, c.value, v_total);
  SELECT role::text INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;

  UPDATE public.concessions
     SET status        = 'rejected',
         decision_note = NULLIF(btrim(COALESCE(_reason, '')), '')
   WHERE id = _id;

  INSERT INTO public.concession_audit
    (concession_id, student_id, fee_ledger_id, action,
     old_type, old_value, new_type, new_value, old_amount, new_amount,
     reason, actor_user_id, actor_role)
  VALUES
    (_id, c.student_id, c.fee_ledger_id, 'remove',
     c.type, c.value, NULL, NULL, v_old_amount, 0,
     NULLIF(btrim(COALESCE(_reason, '')), ''), auth.uid(), v_role);

  PERFORM public.sync_fee_ledger_concessions(c.student_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_fee_concession(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
