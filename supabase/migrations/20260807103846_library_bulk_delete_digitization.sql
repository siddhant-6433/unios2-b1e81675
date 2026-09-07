-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807103846 name=library_bulk_delete_digitization applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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
