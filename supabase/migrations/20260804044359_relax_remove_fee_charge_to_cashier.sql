-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260804044359 name=relax_remove_fee_charge_to_cashier applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.remove_fee_charge(
  _fee_ledger_id uuid,
  _reason        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT fl.*, fc.code INTO v_row
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
   WHERE fl.id = _fee_ledger_id;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Fee item not found';
  END IF;

  IF NOT (public.can_collect_fee(auth.uid())
          OR public.can_manage_fee_structure(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to remove fee items';
  END IF;

  IF COALESCE(v_row.paid_amount, 0) > 0 THEN
    RAISE EXCEPTION
      'Cannot remove %: % already paid against it. Reallocate or refund it instead.',
      v_row.code, v_row.paid_amount
      USING ERRCODE = 'restrict_violation';
  END IF;

  DELETE FROM public.fee_ledger WHERE id = _fee_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_fee_charge(uuid, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.removable_fee_code_ids(uuid);

NOTIFY pgrst, 'reload schema';
