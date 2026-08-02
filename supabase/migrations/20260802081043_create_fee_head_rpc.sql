-- ====================================================================
-- Let a super_admin mint a brand-new fee head (Sports, Transfer
-- Certificate, Arrear Fee…) from the Custom Heads panel.
--
-- Without this the panel could only scope fee codes that already exist,
-- and every existing code is a recurring structure component — so none of
-- the ad-hoc counter charges could actually be created.
--
-- Why an RPC and not a plain insert: fee_codes has a "super_admin OR
-- accountant can manage" RLS policy, but the table GRANT to authenticated
-- is SELECT only (20260322170000_grant_table_permissions.sql:32). The
-- policy has therefore never been reachable — an insert fails on table
-- privileges before RLS is even consulted. Rather than widen the grant on
-- a money table, route the one write we need through a definer function
-- gated by the same helper the rest of this feature uses.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.create_fee_head(
  _name     text,
  _code     text DEFAULT NULL,
  _category text DEFAULT 'other'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text;
  v_id   uuid;
BEGIN
  IF NOT public.can_manage_fee_structure(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can create a fee head';
  END IF;

  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'A name is required';
  END IF;

  -- Derive a code from the name when the caller doesn't supply one:
  -- "Transfer Certificate" -> "TRANSFER-CERTIFICATE".
  v_code := upper(btrim(COALESCE(NULLIF(btrim(_code), ''), _name)));
  v_code := regexp_replace(v_code, '[^A-Z0-9]+', '-', 'g');
  v_code := btrim(v_code, '-');
  IF v_code = '' THEN
    RAISE EXCEPTION 'Could not derive a fee code from "%"', _name;
  END IF;

  SELECT id INTO v_id FROM public.fee_codes WHERE code = v_code;
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'A fee head with code % already exists', v_code;
  END IF;

  INSERT INTO public.fee_codes (code, name, category, is_recurring)
  VALUES (v_code, btrim(_name), COALESCE(NULLIF(btrim(_category), ''), 'other'), false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_fee_head(text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
