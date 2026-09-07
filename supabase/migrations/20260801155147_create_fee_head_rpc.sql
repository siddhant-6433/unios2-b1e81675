-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260801155147 name=create_fee_head_rpc applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
