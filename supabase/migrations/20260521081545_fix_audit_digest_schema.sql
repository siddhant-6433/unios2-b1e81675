-- Fix: pgcrypto's digest() lives in the `extensions` schema, but the
-- audit trigger function pins search_path=public, so unqualified
-- digest() resolves to nothing → "function digest(text, unknown) does
-- not exist", which rolls back any lead_payments INSERT/UPDATE/DELETE.
-- Symptom: offline Token Fee recording failed at the audit trigger.

CREATE OR REPLACE FUNCTION public.fn_lead_payments_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    encode(extensions.digest(v_canonical::bytea, 'sha256'::text), 'hex')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

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
SET search_path = public, extensions
AS $$
DECLARE
  r           record;
  v_prev_hash text := NULL;
  v_canonical text;
  v_expected  text;
BEGIN
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
    v_expected := encode(extensions.digest(v_canonical::bytea, 'sha256'::text), 'hex');

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
