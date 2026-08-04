-- ====================================================================
-- A cashier may remove any UNPAID row from a candidate's own ledger.
--
-- The previous cut let an accountant remove only ad-hoc catalog charges,
-- on the reasoning that deleting a boarding row "changes what the student
-- owes". Owner correction: removing a row from one candidate's fee_ledger
-- is a per-candidate correction, not an edit to the fee structure. The
-- structure template (fee_structures / fee_structure_items) is untouched
-- and every other student on it is unaffected — which is exactly the case
-- when a day scholar is mis-provisioned with a boarding head, or a term is
-- billed that does not apply to this candidate.
--
-- What stays: a row with money against it is still never removable. That
-- money has to be reallocated (transfer_fee_allocation) or refunded, never
-- silently erased. And the delete still runs through this definer function
-- rather than a table grant, so payment_audit_log records it with an actor.
-- ====================================================================

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

  -- Cashier (accountant/super_admin) or anyone who may edit fee structures.
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

-- No longer needed: the UI does not have to ask which heads are ad-hoc, since
-- the gate is now "unpaid" rather than "ad-hoc".
DROP FUNCTION IF EXISTS public.removable_fee_code_ids(uuid);

NOTIFY pgrst, 'reload schema';
