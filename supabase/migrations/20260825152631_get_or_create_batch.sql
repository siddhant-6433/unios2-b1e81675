-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260825152631 name=get_or_create_batch applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.get_or_create_batch(
  _course_id uuid,
  _session_id uuid,
  _name text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(_name);
BEGIN
  IF _course_id IS NULL OR _session_id IS NULL OR v_name IS NULL OR v_name = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM public.batches
   WHERE course_id = _course_id AND session_id = _session_id AND name = v_name
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.batches (course_id, session_id, name)
  VALUES (_course_id, _session_id, v_name)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_batch(uuid, uuid, text) TO authenticated, service_role;
