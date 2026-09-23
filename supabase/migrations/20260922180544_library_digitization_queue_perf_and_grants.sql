-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260922180544; git must keep this timestamp so `db push`
-- does not treat an already-applied migration as new.
--
-- Library digitization queue: evaluate branch access once per branch instead of
-- once per record. The first cut called library_user_can_access_branch() inside a
-- per-row predicate over 8,207 staging rows, which hit the statement timeout
-- (SQLSTATE 57014) — including for anonymous callers, whose per-row check could
-- never succeed.
--
-- Also revoke PUBLIC execute: Postgres grants EXECUTE to PUBLIC by default, so
-- `GRANT ... TO authenticated` alone left these RPCs callable by anon. SECURITY
-- DEFINER functions run as the owner regardless, so internal calls are unaffected.

-- ---------------------------------------------------------------------------
-- 1. Branch ids the user can access for an action, computed once per branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_accessible_branch_ids(
  _user_id uuid,
  _action text DEFAULT 'view'
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(b.id ORDER BY b.id), ARRAY[]::uuid[])
  FROM public.library_branches b
  WHERE public.library_user_can_access_branch(_user_id, b.id, _action);
$$;

-- ---------------------------------------------------------------------------
-- 2. Branch ids whose digitization queue the user may read: digitize capability,
--    plus campus `view` for principal / campus_admin oversight.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_queue_branch_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(
      public.library_accessible_branch_ids(_user_id, 'digitize')
      || CASE
           WHEN public.has_role(_user_id, 'principal'::public.app_role)
             OR public.has_role(_user_id, 'campus_admin'::public.app_role)
           THEN public.library_accessible_branch_ids(_user_id, 'view')
           ELSE ARRAY[]::uuid[]
         END
    ) AS x
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Queue summary — set-based access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_digitization_summary(_branch_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  total int, pending int, captured int, matched int, needs_review int,
  approved int, duplicate int, rejected int,
  enriched int, no_match int, not_tried int, missing_cover int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branches uuid[] := public.library_queue_branch_ids(auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE d.status IN ('captured', 'matched', 'needs_review'))::int,
    count(*) FILTER (WHERE d.status = 'captured')::int,
    count(*) FILTER (WHERE d.status = 'matched')::int,
    count(*) FILTER (WHERE d.status = 'needs_review')::int,
    count(*) FILTER (WHERE d.status = 'approved')::int,
    count(*) FILTER (WHERE d.status = 'duplicate')::int,
    count(*) FILTER (WHERE d.status = 'rejected')::int,
    count(*) FILTER (WHERE d.status IN ('captured', 'matched', 'needs_review') AND d.enrichment_status = 'enriched')::int,
    count(*) FILTER (WHERE d.status IN ('captured', 'matched', 'needs_review') AND d.enrichment_status = 'no_match')::int,
    count(*) FILTER (WHERE d.status IN ('captured', 'matched', 'needs_review') AND d.enrichment_status IS NULL)::int,
    count(*) FILTER (WHERE d.status IN ('captured', 'matched', 'needs_review') AND d.cover_image_url IS NULL)::int
  FROM public.library_digitization_records d
  WHERE d.branch_id IS NOT NULL
    AND d.branch_id = ANY(v_branches)
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids));
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Paged queue listing — set-based access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_list_digitization_records(
  _branch_ids uuid[] DEFAULT NULL,
  _statuses text[] DEFAULT NULL,
  _enrichment text DEFAULT NULL,
  _search text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS SETOF public.library_digitization_records
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allowed AS (
    SELECT public.library_queue_branch_ids(auth.uid()) AS ids
  )
  SELECT d.*
  FROM public.library_digitization_records d
  CROSS JOIN allowed a
  WHERE d.branch_id IS NOT NULL
    AND d.branch_id = ANY(a.ids)
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND (_statuses IS NULL OR d.status::text = ANY(_statuses))
    AND (
      _enrichment IS NULL OR _enrichment = 'all'
      OR (_enrichment = 'enriched' AND d.enrichment_status = 'enriched')
      OR (_enrichment = 'no_match' AND d.enrichment_status = 'no_match')
      OR (_enrichment = 'not_tried' AND d.enrichment_status IS NULL)
      OR (_enrichment = 'missing_cover' AND d.cover_image_url IS NULL)
    )
    AND (
      _search IS NULL OR btrim(_search) = ''
      OR d.title ILIKE '%' || btrim(_search) || '%'
      OR d.authors_text ILIKE '%' || btrim(_search) || '%'
      OR d.accession_no ILIKE '%' || btrim(_search) || '%'
      OR d.isbn ILIKE '%' || btrim(_search) || '%'
    )
  ORDER BY d.created_at DESC NULLS LAST, d.id
  LIMIT greatest(_limit, 1)
  OFFSET greatest(_offset, 0);
$$;

-- ---------------------------------------------------------------------------
-- 5. Duplicate marking — set-based access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_mark_duplicate_accessions(_branch_ids uuid[] DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marked int := 0;
  v_tmp int;
  v_branches uuid[] := public.library_accessible_branch_ids(auth.uid(), 'digitize');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH scoped AS (
    SELECT d.id,
           row_number() OVER (
             PARTITION BY b.institution_id, lower(btrim(coalesce(d.accession_no, '')))
             ORDER BY d.created_at NULLS LAST, d.id
           ) AS rn
    FROM public.library_digitization_records d
    JOIN public.library_branches b ON b.id = d.branch_id
    WHERE d.status IN ('captured', 'matched', 'needs_review')
      AND btrim(coalesce(d.accession_no, '')) <> ''
      AND d.branch_id = ANY(v_branches)
      AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
  )
  UPDATE public.library_digitization_records d
  SET status = 'duplicate',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now(),
      notes = btrim(concat_ws(' · ', nullif(d.notes, ''), 'Duplicate accession in queue'))
  FROM scoped s
  WHERE d.id = s.id AND s.rn > 1 AND d.status IN ('captured', 'matched', 'needs_review');
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_marked := v_marked + v_tmp;

  UPDATE public.library_digitization_records d
  SET status = 'duplicate',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now(),
      notes = btrim(concat_ws(' · ', nullif(d.notes, ''), 'Accession already in catalog'))
  FROM public.library_branches b
  WHERE d.branch_id = b.id
    AND d.status IN ('captured', 'matched', 'needs_review')
    AND btrim(coalesce(d.accession_no, '')) <> ''
    AND d.branch_id = ANY(v_branches)
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND EXISTS (
      SELECT 1 FROM public.library_items li
      WHERE li.institution_id = b.institution_id
        AND lower(li.accession_no) = lower(btrim(d.accession_no))
    );
  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_marked := v_marked + v_tmp;

  RETURN v_marked;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Bulk approval — set-based access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_bulk_approve_digitization(
  _record_ids uuid[] DEFAULT NULL,
  _branch_ids uuid[] DEFAULT NULL,
  _batch_id uuid DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS TABLE(approved int, failed int, remaining int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved int := 0;
  v_failed int := 0;
  v_remaining int := 0;
  v_branches uuid[] := public.library_accessible_branch_ids(auth.uid(), 'catalog');
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR r IN
    SELECT d.id
    FROM public.library_digitization_records d
    WHERE d.status IN ('captured', 'matched', 'needs_review')
      AND d.branch_id IS NOT NULL
      AND d.branch_id = ANY(v_branches)
      AND (_record_ids IS NULL OR d.id = ANY(_record_ids))
      AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
      AND (_batch_id IS NULL OR d.batch_id = _batch_id)
      AND coalesce(d.notes, '') NOT LIKE '%Approval skipped%'
    ORDER BY d.created_at NULLS LAST, d.id
    LIMIT greatest(_limit, 1)
  LOOP
    BEGIN
      PERFORM public.library_approve_digitization_record(
        r.id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      );
      v_approved := v_approved + 1;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
      UPDATE public.library_digitization_records
      SET notes = btrim(concat_ws(' · ', nullif(notes, ''), 'Approval skipped: ' || SQLERRM)),
          updated_at = now()
      WHERE id = r.id;
    END;
  END LOOP;

  SELECT count(*)::int INTO v_remaining
  FROM public.library_digitization_records d
  WHERE d.status IN ('captured', 'matched', 'needs_review')
    AND d.branch_id IS NOT NULL
    AND d.branch_id = ANY(v_branches)
    AND (_record_ids IS NULL OR d.id = ANY(_record_ids))
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND (_batch_id IS NULL OR d.batch_id = _batch_id)
    AND coalesce(d.notes, '') NOT LIKE '%Approval skipped%';

  RETURN QUERY SELECT v_approved, v_failed, v_remaining;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Lock the new RPCs down to authenticated callers (revoke the default PUBLIC).
--    Internal SECURITY DEFINER calls run as the owner, so revoking is safe.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.library_user_has_explicit_assignment(uuid)',
    'public.library_can_view_digitization(uuid, uuid)',
    'public.library_digitization_summary(uuid[])',
    'public.library_list_digitization_records(uuid[], text[], text, text, int, int)',
    'public.library_existing_accessions(uuid, text[])',
    'public.library_mark_duplicate_accessions(uuid[])',
    'public.library_bulk_approve_digitization(uuid[], uuid[], uuid, int)',
    'public.library_delete_digitization_batch(uuid)',
    'public.library_place_hold(uuid)',
    'public.library_access_matrix(uuid)',
    'public.library_set_access(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean)',
    'public.library_remove_access(uuid, uuid)',
    'public.library_accessible_branch_ids(uuid, text)',
    'public.library_queue_branch_ids(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.library_accessible_branch_ids(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_queue_branch_ids(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
