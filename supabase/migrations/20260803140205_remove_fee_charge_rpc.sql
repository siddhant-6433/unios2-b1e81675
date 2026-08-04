-- ====================================================================
-- Removing an unpaid fee row goes through an RPC.
--
-- The ledger's Remove button raised "permission denied for table fee_ledger"
-- for EVERY role, not just accountants. fee_ledger has a
-- "Only super_admin can delete fee_ledger" RLS policy, but `authenticated`
-- was never granted DELETE on the table — so the privilege check fails
-- before RLS is ever consulted and the policy has never been reachable.
-- Same grant/RLS drift that already bit fee_codes and optional_fee_heads.
--
-- Rather than widen DELETE on a money table, the one write we need goes
-- through a definer function with an explicit gate — matching
-- levy_fee_charge and delete_lead_payment.
--
-- Who may remove what:
--   super_admin / fee_structure:manage — any unpaid row.
--   accountant                        — only ad-hoc charges from the
--                                       optional_fee_heads catalog, i.e. the
--                                       exact mirror of what they can levy.
--                                       A cashier who fat-fingers "IB Meal
--                                       Addon × Q3" must be able to undo it
--                                       without escalating, but must NOT be
--                                       able to delete a tuition or boarding
--                                       row and change what the student owes.
--
-- A paid row is never removable by anyone: the money has to be reallocated
-- (transfer_fee_allocation) or refunded, not silently erased.
-- The existing payment_audit_log trigger on fee_ledger records the DELETE.
-- ====================================================================

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

  -- Is this head one the cashier could have levied themselves?
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

-- Mirrors the RPC's gate so the UI can hide a button it cannot use, rather
-- than surfacing a raw privilege error on click.
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
