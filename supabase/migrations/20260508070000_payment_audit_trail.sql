-- ====================================================================
-- Phase 2 — Payment audit trail.
--
-- Every change to a payment-related row is captured: who, when, op,
-- before, after, and a diff. One generic trigger function attached to
-- every relevant table so we don't drift over time.
--
-- Tables audited:
--   lead_payments         — pre-AN money received
--   payments              — post-AN money received
--   fee_ledger            — student dues / paid_amount / concession edits
--   fee_ledger_payments   — link rows showing how money was applied
--   concessions           — concession requests / approvals / rejections
--   offer_waivers         — offer-letter concession workflow
--   applications.payment_status  — only when payment_status or payment_ref changes
--
-- Read access: super_admin / admission_head / accountant / principal.
-- Service role bypasses RLS so triggers can always write the log.
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_at        timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES auth.users(id),
  -- actor_role captured at trigger time so we can see "who acted as what".
  -- NULL for service-role writes (cron, webhooks).
  actor_role      text,
  op              text NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  table_name      text NOT NULL,
  row_id          uuid NOT NULL,
  -- Human-friendly identifier for the row (e.g. application_id, receipt_no).
  -- Stored separately so audit log is readable without joins.
  natural_key     text,
  changed_fields  text[],         -- only for UPDATE
  old_value       jsonb,          -- before (UPDATE / DELETE)
  new_value       jsonb,          -- after  (INSERT / UPDATE)
  delta           jsonb,          -- {field: {from, to}} convenience for UPDATE
  -- Optional context — populated by callers via session var when relevant
  -- (e.g. refund_reason, manual_reconcile_utr). Not used by the generic
  -- trigger; reserved for future RPC-mediated writes.
  context         jsonb
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_event_at  ON public.payment_audit_log (event_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_audit_table_row ON public.payment_audit_log (table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_actor     ON public.payment_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_natural   ON public.payment_audit_log (natural_key) WHERE natural_key IS NOT NULL;

ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance staff read audit log" ON public.payment_audit_log;
CREATE POLICY "Finance staff read audit log"
  ON public.payment_audit_log FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'principal')
  );

GRANT SELECT ON public.payment_audit_log TO authenticated;
GRANT INSERT, SELECT ON public.payment_audit_log TO service_role;

-- ────────── Generic audit trigger function ──────────────────────────
-- Pulls the natural key (application_id, receipt_no, etc.) from the row
-- if available so the audit log is readable.
-- Skips no-op UPDATEs where no field actually changed.
CREATE OR REPLACE FUNCTION public.fn_payment_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      jsonb;
  v_new      jsonb;
  v_delta    jsonb;
  v_changed  text[];
  v_actor    uuid;
  v_role     text;
  v_natural  text;
  v_row_id   uuid;
  k          text;
BEGIN
  v_actor := auth.uid();
  -- Try to read role from has_role helper; ignore on failure.
  BEGIN
    SELECT role::text INTO v_role
      FROM public.user_roles
     WHERE user_id = v_actor
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_new   := to_jsonb(NEW);
    v_row_id := (v_new->>'id')::uuid;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row_id := COALESCE((v_new->>'id')::uuid, (v_old->>'id')::uuid);
    -- Compute changed fields only (skip identical-row updates).
    SELECT array_agg(key) INTO v_changed
      FROM jsonb_each(v_new) e(key, val)
     WHERE v_new->e.key IS DISTINCT FROM v_old->e.key
       AND e.key NOT IN ('updated_at');  -- timestamp churn alone isn't interesting
    IF v_changed IS NULL OR array_length(v_changed,1) = 0 THEN
      RETURN NEW;
    END IF;
    SELECT jsonb_object_agg(
             k,
             jsonb_build_object('from', v_old->k, 'to', v_new->k)
           )
      INTO v_delta
      FROM unnest(v_changed) AS k;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_row_id := (v_old->>'id')::uuid;
  END IF;

  -- Pull a human-friendly identifier where one exists. Order matters:
  -- application_id > pre_admission_no > admission_no > receipt_no >
  -- transaction_ref. Falls back to NULL.
  v_natural := COALESCE(
    (COALESCE(v_new, v_old))->>'application_id',
    (COALESCE(v_new, v_old))->>'pre_admission_no',
    (COALESCE(v_new, v_old))->>'admission_no',
    (COALESCE(v_new, v_old))->>'receipt_no',
    (COALESCE(v_new, v_old))->>'transaction_ref'
  );

  INSERT INTO public.payment_audit_log
    (actor_user_id, actor_role, op, table_name, row_id, natural_key,
     changed_fields, old_value, new_value, delta)
  VALUES
    (v_actor, v_role, TG_OP, TG_TABLE_NAME, v_row_id, v_natural,
     v_changed, v_old, v_new, v_delta);

  RETURN COALESCE(NEW, OLD);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_payment_audit_log() TO authenticated, service_role;

-- ────────── Attach trigger to every audited table ──────────────────
-- Each block: drop-then-create to be idempotent across reruns.

-- lead_payments
DROP TRIGGER IF EXISTS trg_audit_lead_payments ON public.lead_payments;
CREATE TRIGGER trg_audit_lead_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log();

-- payments
DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments;
CREATE TRIGGER trg_audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log();

-- fee_ledger
DROP TRIGGER IF EXISTS trg_audit_fee_ledger ON public.fee_ledger;
CREATE TRIGGER trg_audit_fee_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log();

-- fee_ledger_payments (link table — INSERT/DELETE is the interesting signal)
DROP TRIGGER IF EXISTS trg_audit_fee_ledger_payments ON public.fee_ledger_payments;
CREATE TRIGGER trg_audit_fee_ledger_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_ledger_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log();

-- concessions (only when the table exists — older deployments may not have it)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'concessions'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_concessions ON public.concessions';
    EXECUTE 'CREATE TRIGGER trg_audit_concessions
               AFTER INSERT OR UPDATE OR DELETE ON public.concessions
               FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log()';
  END IF;
END $$;

-- offer_waivers
DROP TRIGGER IF EXISTS trg_audit_offer_waivers ON public.offer_waivers;
CREATE TRIGGER trg_audit_offer_waivers
  AFTER INSERT OR UPDATE OR DELETE ON public.offer_waivers
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_audit_log();

-- applications.payment_status / payment_ref
-- Narrower trigger: only fire when payment fields actually move.
DROP TRIGGER IF EXISTS trg_audit_applications_payment ON public.applications;
CREATE TRIGGER trg_audit_applications_payment
  AFTER UPDATE OF payment_status, payment_ref, pending_txnid ON public.applications
  FOR EACH ROW
  WHEN (
    OLD.payment_status IS DISTINCT FROM NEW.payment_status OR
    OLD.payment_ref    IS DISTINCT FROM NEW.payment_ref OR
    OLD.pending_txnid  IS DISTINCT FROM NEW.pending_txnid
  )
  EXECUTE FUNCTION public.fn_payment_audit_log();

COMMENT ON TABLE  public.payment_audit_log IS 'Immutable audit log of every change to financial tables. Triggered automatically by fn_payment_audit_log(). Visible to finance staff only.';
COMMENT ON COLUMN public.payment_audit_log.delta IS 'For UPDATE: { field_name: { from: old_value, to: new_value } } for every changed field — use this for quick diff display in admin UI.';
