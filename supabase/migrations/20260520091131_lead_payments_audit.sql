-- Append-only audit trail for lead_payments.
--
-- Every INSERT / UPDATE / DELETE on lead_payments writes one row here,
-- capturing:
--   • who made the change (auth.uid + snapshot of profile name + role)
--   • when (changed_at)
--   • what action (INSERT | UPDATE | DELETE)
--   • full before_row + after_row JSON snapshots
--   • which columns changed (UPDATE only)
--   • a SHA-256 hash chain so any tampering with the audit table itself
--     is detectable by walking the chain.
--
-- The chain is per-payment: each audit row's row_hash is sha256 of
-- (prev_hash || action || actor || before_row || after_row). If anyone
-- edits/deletes an audit row out-of-band, the next link's prev_hash will
-- no longer match the recomputed hash of the prior row → mismatch
-- detected by public.verify_lead_payment_audit_chain().
--
-- RLS: only super_admin can SELECT. Direct INSERT/UPDATE/DELETE on the
-- audit table is revoked from authenticated and anon; the trigger is
-- SECURITY DEFINER so it can still insert.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.lead_payments_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_payment_id     uuid NOT NULL,
  action              text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_at          timestamptz NOT NULL DEFAULT now(),
  changed_by_user_id  uuid,
  changed_by_name     text,
  changed_by_role     text,
  before_row          jsonb,
  after_row           jsonb,
  changed_fields      text[],
  reason              text,
  prev_hash           text,
  row_hash            text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lpa_payment_time
  ON public.lead_payments_audit (lead_payment_id, changed_at DESC);

------------------------------------------------------------------------
-- Trigger function
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_lead_payments_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
  v_user_name      text;
  v_user_role      text;
  v_action         text;
  v_pid            uuid;
  v_before         jsonb;
  v_after          jsonb;
  v_changed_fields text[];
  v_prev_hash      text;
  v_canonical      text;
  v_reason         text;
BEGIN
  v_user_id := auth.uid();
  v_pid     := COALESCE(NEW.id, OLD.id);

  -- Caller may stash a free-form reason via:
  --   SELECT set_config('app.audit_reason', 'Corrected typo in amount', true);
  -- right before the UPDATE / DELETE. The flag is transaction-local.
  BEGIN
    v_reason := NULLIF(current_setting('app.audit_reason', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_reason := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'INSERT';
    v_before := NULL;
    v_after  := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'UPDATE';
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    SELECT array_agg(k) INTO v_changed_fields
      FROM (
        SELECT key AS k
          FROM jsonb_each(v_after) a
         WHERE v_before -> a.key IS DISTINCT FROM a.value
      ) s;
  ELSE
    v_action := 'DELETE';
    v_before := to_jsonb(OLD);
    v_after  := NULL;
  END IF;

  -- Snapshot actor's profile + role at change time. We capture name/role
  -- inline so reading the audit later doesn't depend on the user still
  -- existing or still having the same role.
  IF v_user_id IS NOT NULL THEN
    SELECT p.display_name,
           (SELECT ur.role::text
              FROM public.user_roles ur
             WHERE ur.user_id = v_user_id
             ORDER BY ur.role
             LIMIT 1)
      INTO v_user_name, v_user_role
      FROM public.profiles p
     WHERE p.user_id = v_user_id
     LIMIT 1;
  END IF;

  -- Hash-chain link for this payment.
  SELECT row_hash INTO v_prev_hash
    FROM public.lead_payments_audit
   WHERE lead_payment_id = v_pid
   ORDER BY changed_at DESC, id DESC
   LIMIT 1;

  v_canonical :=
       COALESCE(v_prev_hash, '')
    || '|' || v_action
    || '|' || COALESCE(v_user_id::text, 'system')
    || '|' || COALESCE(v_before::text, '')
    || '|' || COALESCE(v_after::text, '');

  INSERT INTO public.lead_payments_audit (
    lead_payment_id, action, changed_by_user_id, changed_by_name, changed_by_role,
    before_row, after_row, changed_fields, reason, prev_hash, row_hash
  ) VALUES (
    v_pid, v_action, v_user_id, v_user_name, v_user_role,
    v_before, v_after, v_changed_fields, v_reason, v_prev_hash,
    encode(digest(v_canonical, 'sha256'), 'hex')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_payments_audit ON public.lead_payments;
CREATE TRIGGER trg_lead_payments_audit
AFTER INSERT OR UPDATE OR DELETE ON public.lead_payments
FOR EACH ROW EXECUTE FUNCTION public.fn_lead_payments_audit();

------------------------------------------------------------------------
-- RLS + grants
------------------------------------------------------------------------
ALTER TABLE public.lead_payments_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lpa_super_admin_select ON public.lead_payments_audit;
CREATE POLICY lpa_super_admin_select
  ON public.lead_payments_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'super_admin'
    )
  );

-- Block direct mutations from anywhere except the SECURITY DEFINER trigger.
REVOKE INSERT, UPDATE, DELETE ON public.lead_payments_audit FROM authenticated, anon;

------------------------------------------------------------------------
-- Chain verification — recomputes every row_hash for a payment and
-- returns whether the chain is intact. Super-admin can call this from
-- the UI to prove the audit trail hasn't been tampered with.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_lead_payment_audit_chain(_payment_id uuid)
RETURNS TABLE (
  audit_id     uuid,
  changed_at   timestamptz,
  action       text,
  ok           boolean,
  expected     text,
  recorded     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           record;
  v_prev_hash text := NULL;
  v_canonical text;
  v_expected  text;
BEGIN
  -- Restrict to super_admin since the audit table itself is super_admin-only.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;

  FOR r IN
    SELECT * FROM public.lead_payments_audit
     WHERE lead_payment_id = _payment_id
     ORDER BY changed_at ASC, id ASC
  LOOP
    v_canonical :=
         COALESCE(v_prev_hash, '')
      || '|' || r.action
      || '|' || COALESCE(r.changed_by_user_id::text, 'system')
      || '|' || COALESCE(r.before_row::text, '')
      || '|' || COALESCE(r.after_row::text, '');
    v_expected := encode(digest(v_canonical, 'sha256'), 'hex');

    audit_id   := r.id;
    changed_at := r.changed_at;
    action     := r.action;
    expected   := v_expected;
    recorded   := r.row_hash;
    ok         := (v_expected = r.row_hash);
    RETURN NEXT;

    v_prev_hash := r.row_hash;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_lead_payment_audit_chain(uuid) TO authenticated;

------------------------------------------------------------------------
-- Wrappers that pair an edit/delete with the audit reason in ONE
-- transaction. We can't use a plain set_config() RPC + UPDATE from the
-- client because PostgREST closes the transaction between requests, so
-- the GUC wouldn't survive. These wrappers run both in the same tx:
-- set_config(local=true) → mutation → audit trigger reads the reason.
--
-- Both are super_admin-only. Any other role calling them gets a
-- "Forbidden" exception even though the function is SECURITY DEFINER.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_lead_payment(
  _id              uuid,
  _amount          numeric,
  _payment_mode    text,
  _transaction_ref text,
  _payment_date    timestamptz,
  _notes           text,
  _reason          text
)
RETURNS public.lead_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.lead_payments;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required for receipt edit';
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);

  UPDATE public.lead_payments
     SET amount          = _amount,
         payment_mode    = _payment_mode,
         transaction_ref = _transaction_ref,
         payment_date    = _payment_date,
         notes           = _notes
   WHERE id = _id
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Receipt % not found', _id;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_lead_payment(
  _id     uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: super_admin only';
  END IF;
  IF COALESCE(TRIM(_reason), '') = '' THEN
    RAISE EXCEPTION 'Reason required for receipt deletion';
  END IF;

  PERFORM set_config('app.audit_reason', _reason, true);
  DELETE FROM public.lead_payments WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_lead_payment(uuid, numeric, text, text, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_lead_payment(uuid, text) TO authenticated;
