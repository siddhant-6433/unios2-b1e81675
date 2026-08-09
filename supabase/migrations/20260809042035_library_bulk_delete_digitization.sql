-- Bulk hard-delete digitization records the caller has digitize access to.
-- Returns the number of rows actually deleted (rows in branches the caller
-- can't access are silently skipped, same permission model as the per-record RPCs).
CREATE OR REPLACE FUNCTION public.library_delete_digitization_records(
  _record_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF _record_ids IS NULL OR array_length(_record_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.library_digitization_records r
  WHERE r.id = ANY(_record_ids)
    AND r.branch_id IS NOT NULL
    AND public.library_user_can_access_branch(auth.uid(), r.branch_id, 'digitize');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.library_delete_digitization_records(uuid[]) TO authenticated;
