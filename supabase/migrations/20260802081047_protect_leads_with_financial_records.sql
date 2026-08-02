-- ====================================================================
-- A lead that has taken money cannot be deleted.
--
-- Every receipt in this system hangs off lead_payments.lead_id — including
-- post-admission collections, which are written against the student's
-- originating lead. And lead_payments.lead_id is ON DELETE CASCADE, as are
-- payment_links, offer_letters, consultant_payouts,
-- consultant_lead_commissions and abvmu_deposit_claims.
--
-- So deleting a lead vacuums its financial history. Worse, FK cascades run
-- as the system and DO NOT evaluate RLS, so the cascade slips past both the
-- super_admin-only DELETE policy on lead_payments
-- (20260508082000_lock_down_payment_deletes.sql) and the audited
-- delete_lead_payment(id, reason) path. Nothing in 849 migrations stopped
-- this: there was no BEFORE DELETE trigger on public.leads at all.
--
-- Only luck has prevented an incident — applications.lead_id is RESTRICT
-- and students.lead_id is NO ACTION, which accidentally shields most paying
-- leads. A lead who paid at the counter without filing an application had
-- no protection whatsoever, and the cashier console makes that case common.
--
-- This must be a TRIGGER, not an RLS policy or a frontend check: leads are
-- purged manually at the end of each admission cycle, often straight
-- through psql or Studio. A trigger fires for every one of those paths.
--
-- Scope, measured on production at the time of writing: 343 of 24,696 leads
-- (1.4%) are protected. The other 98.6% remain freely purgeable.
--
-- Known limit, stated plainly: a superuser can DISABLE TRIGGER or set
-- session_replication_role = 'replica'. This is a guard against accident,
-- not a vault against intent.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_block_delete_lead_with_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipts int;
  v_reason   text;
BEGIN
  -- Only money that actually landed blocks the delete. An abandoned or
  -- pending gateway attempt carries no money and must not wedge a purge.
  -- receipt_no is assigned only on confirm (fn_assign_receipt_no_on_confirm),
  -- so the two conditions overlap by design — the OR catches a confirmed row
  -- whose numbering trigger failed.
  SELECT count(*) INTO v_receipts
    FROM public.lead_payments
   WHERE lead_id = OLD.id
     AND (receipt_no IS NOT NULL OR status = 'confirmed');

  IF v_receipts > 0 THEN
    v_reason := format('has %s receipt(s) on file', v_receipts);

  ELSIF OLD.pre_admission_no IS NOT NULL OR OLD.admission_no IS NOT NULL THEN
    -- Catches a lead that reached admission through a path leaving no
    -- lead_payments row of its own.
    v_reason := format('carries %s', COALESCE(OLD.admission_no, OLD.pre_admission_no));

  ELSIF EXISTS (SELECT 1 FROM public.consultant_lead_commissions WHERE lead_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.abvmu_deposit_claims        WHERE lead_id = OLD.id) THEN
    v_reason := 'has consultant commission / ABVMU deposit records';
  END IF;

  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot delete lead "%" (%) — it %. Financial records must be retained. '
      'To remove the money first, use delete_lead_payment(<payment_id>, <reason>), '
      'which is super_admin-only and audited.',
      OLD.name, OLD.id, v_reason
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_delete_lead_with_financials ON public.leads;
CREATE TRIGGER trg_block_delete_lead_with_financials
BEFORE DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fn_block_delete_lead_with_financials();

-- Keeps the guard's own lookup cheap on bulk purges.
CREATE INDEX IF NOT EXISTS idx_lead_payments_lead_confirmed
  ON public.lead_payments (lead_id)
  WHERE receipt_no IS NOT NULL OR status = 'confirmed';

NOTIFY pgrst, 'reload schema';
