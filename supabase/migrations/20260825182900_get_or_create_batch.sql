-- get_or_create_batch — the single seam for assigning a batch by label.
--
-- Batches are course + session scoped (batches.name is free text, convention
-- "admissionYear-gradYear" e.g. 2025-27). Nothing in the app created batches
-- before this — the ~10 that existed were hand-made in SQL — so bulk-imported
-- students never got a batch_id. Bulk import and the one-time backfill both call
-- this to resolve an existing (course, session, name) batch or create it.
--
-- SECURITY DEFINER so non-super-admin importers pass the batches-insert RLS.
-- Idempotent: a repeat call with the same (course, session, name) returns the
-- same id and inserts nothing.

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
