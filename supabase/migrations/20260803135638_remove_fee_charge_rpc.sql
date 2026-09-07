-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260803135638 name=remove_fee_charge_rpc applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.remove_fee_charge(
  _fee_ledger_id uuid,
  _reason        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row        record;
  v_is_adhoc   boolean;
  v_privileged boolean;
BEGIN
  SELECT fl.*, fc.code INTO v_row
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.id = _fee_ledger_id;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Fee item not found';
  END IF;

  IF COALESCE(v_row.paid_amount, 0) > 0 THEN
    RAISE EXCEPTION
      'Cannot remove %: % already paid against it. Reallocate or refund it instead.',
      v_row.code, v_row.paid_amount
      USING ERRCODE = 'restrict_violation';
  END IF;

  v_privileged := public.can_manage_fee_structure(auth.uid());

  SELECT EXISTS (
    SELECT 1 FROM public.optional_fee_heads ofh
     WHERE ofh.fee_code_id = v_row.fee_code_id
  ) INTO v_is_adhoc;

  IF NOT v_privileged THEN
    IF NOT public.has_role(auth.uid(), 'accountant') THEN
      RAISE EXCEPTION 'Not authorised to remove fee items';
    END IF;
    IF NOT v_is_adhoc THEN
      RAISE EXCEPTION
        'A cashier can only remove ad-hoc charges. % is part of the fee structure — ask a super admin.',
        v_row.code;
    END IF;
  END IF;

  DELETE FROM public.fee_ledger WHERE id = _fee_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_fee_charge(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.removable_fee_code_ids(_student_id uuid)
RETURNS TABLE (fee_code_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ofh.fee_code_id
    FROM public.optional_fee_heads ofh
   WHERE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.removable_fee_code_ids(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
