-- ====================================================================
-- PRE-FIX: audit trigger had an ambiguous column reference in
-- unnest(v_changed) AS k that collided with the local variable k.
-- Result: every UPDATE on a payment-bearing table errored out with
-- 42702. Discovered when patching APP-26-6OY8 (Bhavna). Fix is to
-- alias the unnest output to a non-conflicting name and reference the
-- column via that alias.
-- ====================================================================

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
BEGIN
  v_actor := auth.uid();
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
    SELECT array_agg(e.key) INTO v_changed
      FROM jsonb_each(v_new) e
     WHERE v_new->e.key IS DISTINCT FROM v_old->e.key
       AND e.key NOT IN ('updated_at');
    IF v_changed IS NULL OR array_length(v_changed,1) = 0 THEN
      RETURN NEW;
    END IF;
    -- Alias unnest output as u(field) so the column doesn't collide
    -- with anything in the outer scope.
    SELECT jsonb_object_agg(
             u.field,
             jsonb_build_object('from', v_old->u.field, 'to', v_new->u.field)
           )
      INTO v_delta
      FROM unnest(v_changed) AS u(field);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_row_id := (v_old->>'id')::uuid;
  END IF;

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

-- ====================================================================
-- Bidirectional payment sync — reverse direction.
--
-- 20260508090000 added forward sync (applications.payment_status=paid
-- → lead_payments INSERT). But we also need the reverse: when an
-- accountant records an application_fee directly in lead_payments
-- (manual cash entry, ad-hoc admin tool, backfill scripts), the
-- application's payment_status must flip to paid so:
--   - Applications page "Paid" filter sees it
--   - Receipt PDF can be generated
--   - sync_lead_stage_on_payment advances lead.stage to
--     application_fee_paid (which surfaces the lead in every Fee Paid
--     dashboard across the app)
--
-- Real-world example: Bhavna (APP-26-6OY8) had receipt N46 / ref
-- 387220375514 confirmed in lead_payments at 06:04 IST today, but the
-- application stayed in payment_status='pending' because nobody
-- updated it.
--
-- Loop safety: the forward mirror trigger has an idempotency guard
-- on transaction_ref, so when this reverse trigger flips the app
-- status and the forward trigger re-fires, it sees the existing row
-- and skips. No double-insert.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.fn_lead_payment_to_application_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id text;
  v_app_status text;
BEGIN
  -- Only act on confirmed application-fee rows. (token / registration /
  -- other types live in lead_payments alone — they don't have a
  -- corresponding applications row to flip.)
  IF NEW.type <> 'application_fee' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  -- For UPDATE: only act if status just transitioned to 'confirmed'.
  IF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  -- Find the application linked to this lead. If multiple, pick the
  -- most-recently-updated pending one (safest — admins typically have
  -- one open application at a time).
  SELECT application_id, payment_status
    INTO v_app_id, v_app_status
    FROM public.applications
   WHERE lead_id = NEW.lead_id
     AND payment_status IS DISTINCT FROM 'paid'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_app_id IS NULL THEN
    RETURN NEW;  -- No pending application for this lead — nothing to sync
  END IF;

  -- Flip the application. The existing audit + sync_lead_stage_on_payment
  -- + forward mirror triggers all fire on this update; the forward
  -- mirror's idempotency guard catches the round-trip and skips.
  UPDATE public.applications
     SET payment_status = 'paid',
         payment_ref    = COALESCE(payment_ref, NEW.transaction_ref, NEW.receipt_no)
   WHERE application_id = v_app_id;

  -- Fire-and-forget receipt generation so the application's
  -- fee_receipt_url is populated. We use pg_net so the trigger doesn't
  -- block waiting for the function. Best-effort; admin can regenerate
  -- manually if it fails.
  DECLARE
    v_url text;
    v_key text;
  BEGIN
    SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
    IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url     := v_url || '/functions/v1/generate-application-fee-receipt',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body    := jsonb_build_object('application_id', v_app_id)::text
      );
    END IF;
  END;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_lead_payment_to_application_sync() TO service_role, authenticated;

DROP TRIGGER IF EXISTS trg_lead_payment_to_application_sync ON public.lead_payments;
CREATE TRIGGER trg_lead_payment_to_application_sync
  AFTER INSERT OR UPDATE OF status ON public.lead_payments
  FOR EACH ROW
  WHEN (NEW.type = 'application_fee' AND NEW.status = 'confirmed')
  EXECUTE FUNCTION public.fn_lead_payment_to_application_sync();

-- ────────── Backfill: pending applications with confirmed lp ───────
-- Walk every lead that has a confirmed application_fee in lead_payments
-- AND a pending application. Mark the application paid (which will
-- chain into stage advance + audit + receipt generation).
DO $$
DECLARE
  v_app RECORD;
  v_count int := 0;
BEGIN
  FOR v_app IN
    SELECT DISTINCT ON (a.application_id)
           a.application_id, lp.transaction_ref, lp.receipt_no
      FROM public.applications a
      JOIN public.lead_payments lp ON lp.lead_id = a.lead_id
     WHERE a.payment_status IS DISTINCT FROM 'paid'
       AND lp.type = 'application_fee'
       AND lp.status = 'confirmed'
     ORDER BY a.application_id, lp.created_at DESC
  LOOP
    UPDATE public.applications
       SET payment_status = 'paid',
           payment_ref    = COALESCE(payment_ref, v_app.transaction_ref, v_app.receipt_no)
     WHERE application_id = v_app.application_id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '[reverse-mirror-backfill] flipped % applications to paid based on existing lead_payments', v_count;
END $$;
