-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260805080236 name=edit_remove_fee_concession_with_audit applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Edit / reduce / remove a per-row fee concession, with an audit trail.

CREATE TABLE IF NOT EXISTS public.concession_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concession_id  uuid,
  student_id     uuid,
  fee_ledger_id  uuid,
  action         text NOT NULL CHECK (action IN ('edit','remove')),
  old_type       text,
  old_value      numeric(12,2),
  new_type       text,
  new_value      numeric(12,2),
  old_amount     numeric(12,2),
  new_amount     numeric(12,2),
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

CREATE OR REPLACE FUNCTION public.concession_effective_amount(
  _type text, _value numeric, _total numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _type = 'flat' THEN _value
              ELSE round(COALESCE(_total,0) * _value / 100, 2) END;
$$;

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
  IF c.status = 'rejected' THEN RETURN; END IF;

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
