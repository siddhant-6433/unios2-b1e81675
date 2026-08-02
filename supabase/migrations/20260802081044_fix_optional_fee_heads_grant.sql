-- ====================================================================
-- Two fixes found by actually using the Custom Heads panel.
--
-- 1. optional_fee_heads was created with an RLS policy allowing
--    can_manage_fee_structure() to write, but only `GRANT SELECT` to
--    authenticated — so every insert failed with "permission denied for
--    table optional_fee_heads" before RLS was ever consulted. Exactly the
--    grant/RLS drift that already bit fee_codes and academic_partners.
--    RLS still does the gating; the grant just has to allow the attempt.
--
-- 2. create_fee_head raised on a duplicate code. Combined with (1) that
--    was a trap: the panel mints the fee_code, then inserts the head. When
--    the second write failed, the code survived as an orphan and every
--    retry then died on "a fee head with code X already exists" — the user
--    could never get past their own half-completed attempt. Returning the
--    existing id instead makes the pair safely re-runnable.
-- ====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.optional_fee_heads TO authenticated;

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

  v_code := upper(btrim(COALESCE(NULLIF(btrim(_code), ''), _name)));
  v_code := regexp_replace(v_code, '[^A-Z0-9]+', '-', 'g');
  v_code := btrim(v_code, '-');
  IF v_code = '' THEN
    RAISE EXCEPTION 'Could not derive a fee code from "%"', _name;
  END IF;

  -- Idempotent: reuse the code if it already exists rather than erroring,
  -- so a retry after a failed head insert works.
  SELECT id INTO v_id FROM public.fee_codes WHERE code = v_code;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.fee_codes (code, name, category, is_recurring)
  VALUES (v_code, btrim(_name), COALESCE(NULLIF(btrim(_category), ''), 'other'), false)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_fee_head(text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
