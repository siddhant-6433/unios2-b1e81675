-- Library: make the `librarian` role operational without a manual staff assignment,
-- give principal/campus_admin read oversight of the digitization queue, and add
-- set-based accession approval + duplicate handling so large register imports can
-- actually be turned into catalog copies.
--
-- Background: production imported 8,207 register rows but only 1 ever reached the
-- catalog, because (a) the librarian had no `library_staff_assignments` row so every
-- branch-scoped RLS predicate returned false, and (b) approval was one record at a
-- time behind a 200-row client fetch.

-- ---------------------------------------------------------------------------
-- 1. Does the user have an explicit (active) staff assignment anywhere?
--    When they do, the assignment is authoritative and the role fallback below
--    stays off — so an `auditor` assignment still genuinely narrows capability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_user_has_explicit_assignment(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.library_staff_assignments a
    WHERE a.user_id = _user_id
      AND a.active
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Branch access. Adds a role fallback for `librarian` scoped to the user's
--    assigned campus (all branches on their campus), matching how principal and
--    campus_admin already work. Explicit assignments still override the fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_user_can_access_branch(
  _user_id uuid,
  _branch_id uuid,
  _action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.library_branches b
      WHERE b.id = _branch_id
        AND (
          (
            (
              public.has_role(_user_id, 'campus_admin'::public.app_role)
              OR public.has_role(_user_id, 'principal'::public.app_role)
            )
            AND public.user_can_access_assigned_campus(_user_id, b.campus_id)
            AND _action IN ('view', 'manage_settings', 'export')
          )
          OR (
            public.has_role(_user_id, 'librarian'::public.app_role)
            AND NOT public.library_user_has_explicit_assignment(_user_id)
            AND (
              NOT public.user_has_campus_scope(_user_id)
              OR public.user_can_access_assigned_campus(_user_id, b.campus_id)
            )
            AND _action IN ('view', 'catalog', 'circulate', 'inventory', 'digitize', 'export')
          )
          OR EXISTS (
            SELECT 1
            FROM public.library_staff_assignments a
            WHERE a.branch_id = b.id
              AND a.user_id = _user_id
              AND a.active
              AND (
                a.assignment_role = 'manager'
                OR _action = 'view'
                OR (_action = 'catalog' AND a.can_catalog)
                OR (_action = 'circulate' AND a.can_circulate)
                OR (_action = 'inventory' AND a.can_inventory)
                OR (_action = 'digitize' AND a.can_digitize)
                OR (_action = 'manage_settings' AND a.can_manage_settings)
                OR (_action = 'export' AND (a.can_manage_settings OR a.can_inventory OR a.can_circulate))
              )
          )
        )
    )
$$;

-- ---------------------------------------------------------------------------
-- 3. Global "has any library capability". Same role fallback for `librarian`
--    (again only when no explicit assignment exists).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_user_has_any_assignment(
  _user_id uuid,
  _action text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin'::public.app_role)
    OR (
      (
        public.has_role(_user_id, 'campus_admin'::public.app_role)
        OR public.has_role(_user_id, 'principal'::public.app_role)
      )
      AND _action IN ('view', 'manage_settings', 'export')
    )
    OR (
      public.has_role(_user_id, 'librarian'::public.app_role)
      AND NOT public.library_user_has_explicit_assignment(_user_id)
      AND _action IN ('view', 'catalog', 'circulate', 'inventory', 'digitize', 'export')
    )
    OR EXISTS (
      SELECT 1
      FROM public.library_staff_assignments a
      WHERE a.user_id = _user_id
        AND a.active
        AND (
          a.assignment_role = 'manager'
          OR _action = 'view'
          OR (_action = 'catalog' AND a.can_catalog)
          OR (_action = 'circulate' AND a.can_circulate)
          OR (_action = 'inventory' AND a.can_inventory)
          OR (_action = 'digitize' AND a.can_digitize)
          OR (_action = 'manage_settings' AND a.can_manage_settings)
          OR (_action = 'export' AND (a.can_manage_settings OR a.can_inventory OR a.can_circulate))
        )
    )
$$;

-- ---------------------------------------------------------------------------
-- 4. Principal / campus_admin can *read* the digitization queue for their campus
--    (oversight). Writes still require digitize capability.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Library staff view digitization records" ON public.library_digitization_records;
CREATE POLICY "Library staff view digitization records" ON public.library_digitization_records
  FOR SELECT TO authenticated
  USING (
    branch_id IS NOT NULL
    AND (
      public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize')
      OR (
        (
          public.has_role(auth.uid(), 'principal'::public.app_role)
          OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
        )
        AND public.library_user_can_access_branch(auth.uid(), branch_id, 'view')
      )
    )
  );

DROP POLICY IF EXISTS "Library staff view digitization batches" ON public.library_digitization_batches;
CREATE POLICY "Library staff view digitization batches" ON public.library_digitization_batches
  FOR SELECT TO authenticated
  USING (
    branch_id IS NOT NULL
    AND (
      public.library_user_can_access_branch(auth.uid(), branch_id, 'digitize')
      OR (
        (
          public.has_role(auth.uid(), 'principal'::public.app_role)
          OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
        )
        AND public.library_user_can_access_branch(auth.uid(), branch_id, 'view')
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Helper: may the caller read/operate the digitization queue for this branch?
-- (digitize capability, or principal/campus_admin oversight read)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_can_view_digitization(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.library_user_can_access_branch(_user_id, _branch_id, 'digitize')
    OR (
      (
        public.has_role(_user_id, 'principal'::public.app_role)
        OR public.has_role(_user_id, 'campus_admin'::public.app_role)
      )
      AND public.library_user_can_access_branch(_user_id, _branch_id, 'view')
    )
$$;

-- ---------------------------------------------------------------------------
-- 5. Server-side queue summary so the UI no longer depends on a 200-row fetch.
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
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND public.library_can_view_digitization(auth.uid(), d.branch_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Server-side paged queue listing (search + status + enrichment filters).
--    SECURITY DEFINER, so access is re-checked explicitly inside the function.
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
  SELECT d.*
  FROM public.library_digitization_records d
  WHERE d.branch_id IS NOT NULL
    AND public.library_can_view_digitization(auth.uid(), d.branch_id)
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
-- 7. Which of these accession numbers already exist (staging or catalog) for a
--    branch's institution? Used by the importer so a register can't be imported
--    twice (the root cause of the 2,780 duplicate Nursing rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_existing_accessions(
  _branch_id uuid,
  _accessions text[]
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch public.library_branches%ROWTYPE;
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'digitize') THEN
    RAISE EXCEPTION 'You do not have digitization access to this library';
  END IF;
  SELECT * INTO v_branch FROM public.library_branches WHERE id = _branch_id;
  IF v_branch.id IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  RETURN ARRAY(
    SELECT DISTINCT lower(btrim(a))
    FROM unnest(coalesce(_accessions, ARRAY[]::text[])) AS a
    WHERE btrim(a) <> ''
      AND (
        EXISTS (
          SELECT 1 FROM public.library_digitization_records d
          WHERE d.branch_id = _branch_id
            AND d.status NOT IN ('duplicate', 'rejected')
            AND lower(btrim(coalesce(d.accession_no, ''))) = lower(btrim(a))
        )
        OR EXISTS (
          SELECT 1 FROM public.library_items li
          WHERE li.institution_id = v_branch.institution_id
            AND lower(li.accession_no) = lower(btrim(a))
        )
      )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Mark duplicate accession rows (intra-import repeat + already catalogued)
--    as `duplicate` so the pending queue is clean before bulk approval.
--    De-dupes per institution, matching the library_items uniqueness rule.
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- (a) repeat accessions within the pending queue of the same institution — keep the earliest.
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
      AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
      AND public.library_user_can_access_branch(auth.uid(), d.branch_id, 'digitize')
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

  -- (b) accession already exists as a catalogued copy for the branch institution.
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
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND public.library_user_can_access_branch(auth.uid(), d.branch_id, 'digitize')
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
-- 9. Bulk approval. Approves up to `_limit` pending records, minting a catalog
--    title + accession copy per record. Each row is atomic: a failure is
--    recorded in notes and skipped rather than aborting the batch.
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
      AND public.library_user_can_access_branch(auth.uid(), d.branch_id, 'catalog')
      AND (_record_ids IS NULL OR d.id = ANY(_record_ids))
      AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
      AND (_batch_id IS NULL OR d.batch_id = _batch_id)
      -- Don't re-attempt a row that already failed once; it stays visible in the
      -- queue with its "Approval skipped" note for manual review.
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
    AND public.library_user_can_access_branch(auth.uid(), d.branch_id, 'catalog')
    AND (_record_ids IS NULL OR d.id = ANY(_record_ids))
    AND (_branch_ids IS NULL OR d.branch_id = ANY(_branch_ids))
    AND (_batch_id IS NULL OR d.batch_id = _batch_id)
    AND coalesce(d.notes, '') NOT LIKE '%Approval skipped%';

  RETURN QUERY SELECT v_approved, v_failed, v_remaining;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Delete a whole import batch (used to clean up a mistaken double import).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_delete_digitization_batch(_batch_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH deletable AS (
    SELECT d.id
    FROM public.library_digitization_records d
    WHERE d.batch_id = _batch_id
      AND d.status <> 'approved'
      AND d.branch_id IS NOT NULL
      AND public.library_user_can_access_branch(auth.uid(), d.branch_id, 'digitize')
  )
  DELETE FROM public.library_digitization_records d
  USING deletable x
  WHERE d.id = x.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.library_digitization_batches b
  WHERE b.id = _batch_id
    AND b.branch_id IS NOT NULL
    AND public.library_user_can_access_branch(auth.uid(), b.branch_id, 'digitize')
    AND NOT EXISTS (SELECT 1 FROM public.library_digitization_records d WHERE d.batch_id = b.id);

  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Patron self-service: place a hold on a title. Resolves (or lazily creates)
--     the caller's library member row — a linked student member when possible,
--     otherwise a staff/faculty member from their profile.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_place_hold(_book_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_member_id uuid;
  v_student_id uuid;
  v_hold_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.library_books WHERE id = _book_id) THEN
    RAISE EXCEPTION 'Book not found';
  END IF;

  SELECT id INTO v_member_id
  FROM public.library_members
  WHERE user_id = v_user
  LIMIT 1;

  IF v_member_id IS NULL THEN
    SELECT id INTO v_student_id FROM public.students WHERE user_id = v_user LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      BEGIN
        v_member_id := public.library_get_or_create_student_member(v_student_id);
      EXCEPTION WHEN others THEN
        v_member_id := NULL;
      END;
    END IF;
  END IF;

  IF v_member_id IS NULL THEN
    BEGIN
      INSERT INTO public.library_members (user_id, profile_id, member_type, display_name, email, phone, status)
      SELECT v_user,
             p.id,
             CASE
               WHEN public.has_role(v_user, 'faculty'::public.app_role)
                 OR public.has_role(v_user, 'teacher'::public.app_role) THEN 'faculty'
               ELSE 'staff'
             END,
             coalesce(nullif(p.display_name, ''), p.email, 'Library member'),
             p.email,
             p.phone,
             'active'
      FROM public.profiles p
      WHERE p.user_id = v_user
      RETURNING id INTO v_member_id;
    EXCEPTION WHEN others THEN
      v_member_id := NULL;
    END;
    IF v_member_id IS NULL THEN
      INSERT INTO public.library_members (user_id, member_type, display_name, status)
      VALUES (v_user, 'staff', 'Library member', 'active')
      RETURNING id INTO v_member_id;
    END IF;
  END IF;

  SELECT id INTO v_hold_id
  FROM public.library_holds
  WHERE member_id = v_member_id
    AND book_id = _book_id
    AND status IN ('active', 'ready')
  LIMIT 1;

  IF v_hold_id IS NULL THEN
    INSERT INTO public.library_holds (book_id, member_id, status, priority)
    VALUES (_book_id, v_member_id, 'active', 1)
    RETURNING id INTO v_hold_id;
  END IF;

  RETURN v_hold_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Backfill loan-rules for any branch created before settings were wired.
-- ---------------------------------------------------------------------------
INSERT INTO public.library_settings (branch_id, borrowing_days, borrowing_limit, fine_per_day, renewals_allowed, reference_books_circulate)
SELECT b.id, 14, 3, 0, 1, false
FROM public.library_branches b
WHERE NOT EXISTS (
  SELECT 1 FROM public.library_settings s WHERE s.branch_id = b.id
);

-- ---------------------------------------------------------------------------
-- 13. Library access matrix — the §4.2 capability matrix, operable from the UI.
--     Super admin (or anyone with manage_settings on the branch) can grant,
--     adjust, suspend and revoke access per user, per library. This is the
--     authoritative write path for `library_staff_assignments`.
-- ---------------------------------------------------------------------------

-- Roster for a branch: every active non-student/parent profile, with this
-- branch's assignment (if any) and its capability flags.
CREATE OR REPLACE FUNCTION public.library_access_matrix(_branch_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  email text,
  phone text,
  app_role text,
  assignment_id uuid,
  assignment_role text,
  can_catalog boolean,
  can_circulate boolean,
  can_inventory boolean,
  can_digitize boolean,
  can_manage_settings boolean,
  active boolean,
  has_assignment boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'manage_settings') THEN
    RAISE EXCEPTION 'You do not have permission to manage library access';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.display_name,
    p.email,
    p.phone,
    public.get_user_role(p.user_id)::text,
    a.id,
    a.assignment_role,
    coalesce(a.can_catalog, false),
    coalesce(a.can_circulate, false),
    coalesce(a.can_inventory, false),
    coalesce(a.can_digitize, false),
    coalesce(a.can_manage_settings, false),
    coalesce(a.active, false),
    (a.id IS NOT NULL)
  FROM public.profiles p
  LEFT JOIN public.library_staff_assignments a
    ON a.branch_id = _branch_id
   AND a.user_id = p.user_id
  WHERE p.archived_at IS NULL
    AND p.login_disabled = false
    AND (
      a.id IS NOT NULL
      OR coalesce(public.get_user_role(p.user_id)::text, '') NOT IN ('student', 'parent')
    )
  ORDER BY (a.id IS NOT NULL) DESC, p.display_name NULLS LAST;
END;
$$;

-- Grant or adjust a user's access on one library (upsert).
CREATE OR REPLACE FUNCTION public.library_set_access(
  _branch_id uuid,
  _user_id uuid,
  _assignment_role text,
  _can_catalog boolean DEFAULT true,
  _can_circulate boolean DEFAULT true,
  _can_inventory boolean DEFAULT true,
  _can_digitize boolean DEFAULT true,
  _can_manage_settings boolean DEFAULT false,
  _active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_profile uuid;
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'manage_settings') THEN
    RAISE EXCEPTION 'You do not have permission to manage library access';
  END IF;
  IF _assignment_role NOT IN ('manager', 'librarian', 'assistant', 'auditor') THEN
    RAISE EXCEPTION 'Invalid library role %', _assignment_role;
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE user_id = _user_id LIMIT 1;

  INSERT INTO public.library_staff_assignments (
    branch_id, user_id, profile_id, assignment_role,
    can_catalog, can_circulate, can_inventory, can_digitize, can_manage_settings,
    active, created_by
  )
  VALUES (
    _branch_id, _user_id, v_profile, _assignment_role,
    _can_catalog, _can_circulate, _can_inventory, _can_digitize, _can_manage_settings,
    _active, auth.uid()
  )
  ON CONFLICT (branch_id, user_id) DO UPDATE SET
    profile_id = EXCLUDED.profile_id,
    assignment_role = EXCLUDED.assignment_role,
    can_catalog = EXCLUDED.can_catalog,
    can_circulate = EXCLUDED.can_circulate,
    can_inventory = EXCLUDED.can_inventory,
    can_digitize = EXCLUDED.can_digitize,
    can_manage_settings = EXCLUDED.can_manage_settings,
    active = EXCLUDED.active,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Revoke a user's access on one library.
CREATE OR REPLACE FUNCTION public.library_remove_access(_branch_id uuid, _user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  IF NOT public.library_user_can_access_branch(auth.uid(), _branch_id, 'manage_settings') THEN
    RAISE EXCEPTION 'You do not have permission to manage library access';
  END IF;

  DELETE FROM public.library_staff_assignments a
  WHERE a.branch_id = _branch_id
    AND a.user_id = _user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. Indexes backing the paged queue + duplicate marking.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_library_digitization_records_branch_accession
  ON public.library_digitization_records (branch_id, lower(btrim(accession_no)))
  WHERE accession_no IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.library_user_has_explicit_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_can_view_digitization(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_digitization_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_list_digitization_records(uuid[], text[], text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_existing_accessions(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_mark_duplicate_accessions(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_bulk_approve_digitization(uuid[], uuid[], uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_delete_digitization_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_place_hold(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_access_matrix(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_set_access(uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_remove_access(uuid, uuid) TO authenticated;
