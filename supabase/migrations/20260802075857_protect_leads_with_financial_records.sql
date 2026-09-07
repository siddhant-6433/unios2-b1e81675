-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260802075857 name=protect_leads_with_financial_records applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
  SELECT count(*) INTO v_receipts
    FROM public.lead_payments
   WHERE lead_id = OLD.id
     AND (receipt_no IS NOT NULL OR status = 'confirmed');

  IF v_receipts > 0 THEN
    v_reason := format('has %s receipt(s) on file', v_receipts);

  ELSIF OLD.pre_admission_no IS NOT NULL OR OLD.admission_no IS NOT NULL THEN
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

CREATE INDEX IF NOT EXISTS idx_lead_payments_lead_confirmed
  ON public.lead_payments (lead_id)
  WHERE receipt_no IS NOT NULL OR status = 'confirmed';

NOTIFY pgrst, 'reload schema';
