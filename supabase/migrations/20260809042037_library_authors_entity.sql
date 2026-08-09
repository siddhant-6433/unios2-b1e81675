-- Authors as a reusable entity so the same author (often misspelled across registers) is shared
-- across books instead of living as free text. library_books.authors text[] is kept as a
-- denormalized display cache, rewritten in sync by the sync/merge functions.

CREATE TABLE IF NOT EXISTS public.library_authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_authors_normalized ON public.library_authors (normalized_name);
CREATE INDEX IF NOT EXISTS idx_library_authors_trgm ON public.library_authors USING gin (normalized_name extensions.gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.library_book_authors (
  book_id uuid NOT NULL REFERENCES public.library_books(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.library_authors(id) ON DELETE CASCADE,
  position int,
  PRIMARY KEY (book_id, author_id)
);
CREATE INDEX IF NOT EXISTS idx_library_book_authors_author ON public.library_book_authors (author_id);

ALTER TABLE public.library_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_book_authors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users discover library authors" ON public.library_authors;
CREATE POLICY "Authenticated users discover library authors" ON public.library_authors
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Library staff manage authors" ON public.library_authors;
CREATE POLICY "Library staff manage authors" ON public.library_authors
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

DROP POLICY IF EXISTS "Authenticated users discover book authors" ON public.library_book_authors;
CREATE POLICY "Authenticated users discover book authors" ON public.library_book_authors
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Library staff manage book authors" ON public.library_book_authors;
CREATE POLICY "Library staff manage book authors" ON public.library_book_authors
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

-- Normalize an author name for matching: lowercase, collapse whitespace, drop trailing dots.
CREATE OR REPLACE FUNCTION public.library_normalize_name(_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(lower(trim(coalesce(_name, ''))), '\s+', ' ', 'g');
$$;

-- Reuse an existing author by exact-normalized match, else by high trigram similarity
-- (typos like "Nallaswany"/"Nallaswamy"); otherwise create a new author. Borderline
-- near-duplicates below the threshold are left for the merge UI to reconcile.
CREATE OR REPLACE FUNCTION public.library_upsert_author(_name text, _threshold float DEFAULT 0.72)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_norm text;
  v_id uuid;
BEGIN
  v_norm := public.library_normalize_name(_name);
  IF v_norm = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id FROM public.library_authors WHERE normalized_name = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_id
  FROM public.library_authors
  WHERE similarity(normalized_name, v_norm) >= _threshold
  ORDER BY similarity(normalized_name, v_norm) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.library_authors (name, normalized_name, created_by)
  VALUES (trim(_name), v_norm, auth.uid())
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Populate library_book_authors from an author-name array and refresh the denormalized cache.
CREATE OR REPLACE FUNCTION public.library_sync_book_authors(_book_id uuid, _authors text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_author_id uuid;
  i int;
BEGIN
  IF _authors IS NULL OR _book_id IS NULL THEN
    RETURN;
  END IF;
  FOR i IN 1 .. cardinality(_authors) LOOP
    IF nullif(trim(_authors[i]), '') IS NULL THEN
      CONTINUE;
    END IF;
    v_author_id := public.library_upsert_author(_authors[i]);
    IF v_author_id IS NOT NULL THEN
      INSERT INTO public.library_book_authors (book_id, author_id, position)
      VALUES (_book_id, v_author_id, i)
      ON CONFLICT (book_id, author_id) DO UPDATE SET position = LEAST(public.library_book_authors.position, EXCLUDED.position);
    END IF;
  END LOOP;

  UPDATE public.library_books b
  SET authors = COALESCE(
    (SELECT array_agg(a.name ORDER BY ba.position NULLS LAST, a.name)
     FROM public.library_book_authors ba
     JOIN public.library_authors a ON a.id = ba.author_id
     WHERE ba.book_id = _book_id),
    b.authors)
  WHERE b.id = _book_id;
END;
$$;

-- Merge duplicate authors into one canonical author, reassigning links and rewriting caches.
CREATE OR REPLACE FUNCTION public.library_merge_authors(_keep uuid, _merge uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_affected uuid[];
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage authors';
  END IF;
  IF _keep IS NULL OR _merge IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT book_id) INTO v_affected
  FROM public.library_book_authors
  WHERE author_id = _keep OR author_id = ANY(_merge);

  -- Drop links to merged authors on books that already link the survivor, then reassign the rest.
  DELETE FROM public.library_book_authors ba
  WHERE ba.author_id = ANY(_merge)
    AND EXISTS (SELECT 1 FROM public.library_book_authors k WHERE k.book_id = ba.book_id AND k.author_id = _keep);
  UPDATE public.library_book_authors
  SET author_id = _keep
  WHERE author_id = ANY(_merge) AND author_id <> _keep;

  DELETE FROM public.library_authors WHERE id = ANY(_merge) AND id <> _keep;

  UPDATE public.library_books b
  SET authors = COALESCE(
    (SELECT array_agg(a.name ORDER BY ba.position NULLS LAST, a.name)
     FROM public.library_book_authors ba
     JOIN public.library_authors a ON a.id = ba.author_id
     WHERE ba.book_id = b.id),
    '{}'::text[])
  WHERE b.id = ANY(coalesce(v_affected, '{}'::uuid[]));
END;
$$;

-- Near-duplicate author pairs for the merge UI (trigram-indexed via the % operator).
CREATE OR REPLACE FUNCTION public.library_author_duplicate_pairs(_threshold float DEFAULT 0.5)
RETURNS TABLE(id_a uuid, name_a text, id_b uuid, name_b text, sim float)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT a.id, a.name, b.id, b.name, similarity(a.normalized_name, b.normalized_name)::float
  FROM public.library_authors a
  JOIN public.library_authors b ON a.id < b.id
  WHERE a.normalized_name % b.normalized_name
    AND similarity(a.normalized_name, b.normalized_name) >= _threshold
  ORDER BY 5 DESC
  LIMIT 200;
$$;

-- List authors with their book counts (searchable) for the management UI.
CREATE OR REPLACE FUNCTION public.library_list_authors(_search text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS TABLE(id uuid, name text, book_count bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT a.id, a.name, count(ba.book_id) AS book_count
  FROM public.library_authors a
  LEFT JOIN public.library_book_authors ba ON ba.author_id = a.id
  WHERE _search IS NULL OR a.name ILIKE '%' || _search || '%'
  GROUP BY a.id, a.name
  ORDER BY count(ba.book_id) DESC, a.name
  LIMIT greatest(_limit, 1);
$$;

-- Rename an author; if the new name collides with an existing author, merge into it instead.
CREATE OR REPLACE FUNCTION public.library_rename_author(_id uuid, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_norm text;
  v_existing uuid;
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage authors';
  END IF;
  v_norm := public.library_normalize_name(_name);
  IF v_norm = '' THEN
    RAISE EXCEPTION 'Author name cannot be empty';
  END IF;
  SELECT id INTO v_existing FROM public.library_authors WHERE normalized_name = v_norm AND id <> _id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM public.library_merge_authors(v_existing, ARRAY[_id]);
    RETURN;
  END IF;
  UPDATE public.library_authors SET name = trim(_name), normalized_name = v_norm, updated_at = now() WHERE id = _id;
  UPDATE public.library_books b
  SET authors = COALESCE(
    (SELECT array_agg(a.name ORDER BY ba.position NULLS LAST, a.name)
     FROM public.library_book_authors ba JOIN public.library_authors a ON a.id = ba.author_id
     WHERE ba.book_id = b.id),
    b.authors)
  WHERE b.id IN (SELECT book_id FROM public.library_book_authors WHERE author_id = _id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.library_normalize_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_upsert_author(text, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_sync_book_authors(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_merge_authors(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_author_duplicate_pairs(float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_list_authors(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_rename_author(uuid, text) TO authenticated;

-- Wire author-entity population into approval (adds one PERFORM to the Phase-1 body).
CREATE OR REPLACE FUNCTION public.library_approve_digitization_record(
  _record_id uuid,
  _accession_no text DEFAULT NULL,
  _title text DEFAULT NULL,
  _authors_text text DEFAULT NULL,
  _isbn text DEFAULT NULL,
  _publisher text DEFAULT NULL,
  _published_year int DEFAULT NULL,
  _category text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _language text DEFAULT NULL,
  _shelf_location text DEFAULT NULL,
  _rack text DEFAULT NULL,
  _condition text DEFAULT NULL,
  _purchase_price numeric DEFAULT NULL,
  _edition text DEFAULT NULL,
  _pages int DEFAULT NULL,
  _volume text DEFAULT NULL,
  _place text DEFAULT NULL
)
RETURNS TABLE(book_id uuid, item_id uuid, accession_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.library_digitization_records%ROWTYPE;
  v_branch public.library_branches%ROWTYPE;
  v_metadata jsonb;
  v_title text;
  v_authors_text text;
  v_authors text[];
  v_isbn text;
  v_isbn_10 text;
  v_isbn_13 text;
  v_accession_no text;
  v_book_id uuid;
  v_item_id uuid;
  v_cover_url text;
  v_edition text;
  v_pages int;
  v_volume text;
  v_place text;
  v_publisher text;
BEGIN
  SELECT * INTO v_record
  FROM public.library_digitization_records
  WHERE id = _record_id
  FOR UPDATE;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'Digitization record not found';
  END IF;
  IF v_record.branch_id IS NULL THEN
    RAISE EXCEPTION 'Digitization record is not linked to a library';
  END IF;
  IF v_record.status = 'approved' THEN
    RAISE EXCEPTION 'Digitization record is already approved';
  END IF;
  IF NOT public.library_user_can_access_branch(auth.uid(), v_record.branch_id, 'catalog') THEN
    RAISE EXCEPTION 'You do not have catalog access to this library';
  END IF;

  SELECT * INTO v_branch
  FROM public.library_branches
  WHERE id = v_record.branch_id;

  v_metadata := COALESCE(v_record.suggested_metadata, '{}'::jsonb);
  v_title := nullif(trim(coalesce(_title, v_record.title, v_metadata->>'title')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Book title is required before approval';
  END IF;

  v_authors_text := nullif(trim(coalesce(_authors_text, v_record.authors_text)), '');
  IF v_authors_text IS NULL AND jsonb_typeof(v_metadata->'authors') = 'array' THEN
    SELECT string_agg(value, ', ') INTO v_authors_text
    FROM jsonb_array_elements_text(v_metadata->'authors') AS value;
  END IF;
  v_authors := CASE
    WHEN v_authors_text IS NULL THEN ARRAY[]::text[]
    ELSE ARRAY(
      SELECT trim(part)
      FROM regexp_split_to_table(v_authors_text, ',') AS part
      WHERE trim(part) <> ''
    )
  END;

  v_edition := nullif(trim(coalesce(_edition, v_record.edition, v_metadata->>'edition')), '');
  v_pages := coalesce(_pages, v_record.pages);
  v_volume := nullif(trim(coalesce(_volume, v_record.volume)), '');
  v_place := nullif(trim(coalesce(_place, v_record.place)), '');
  v_publisher := nullif(trim(coalesce(_publisher, v_record.publisher, v_metadata->>'publisher')), '');

  v_isbn := regexp_replace(coalesce(_isbn, v_record.isbn, v_metadata->>'isbn_13', v_metadata->>'isbn_10', ''), '[^0-9Xx]', '', 'g');
  v_isbn_10 := CASE WHEN length(v_isbn) = 10 THEN v_isbn ELSE nullif(regexp_replace(coalesce(v_metadata->>'isbn_10', ''), '[^0-9Xx]', '', 'g'), '') END;
  v_isbn_13 := CASE WHEN length(v_isbn) = 13 THEN v_isbn ELSE nullif(regexp_replace(coalesce(v_metadata->>'isbn_13', ''), '[^0-9]', '', 'g'), '') END;
  v_accession_no := nullif(trim(coalesce(_accession_no, v_record.accession_no)), '');
  IF v_accession_no IS NULL THEN
    v_accession_no := public.library_next_accession_no(v_record.branch_id, null);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.library_items li
    WHERE li.institution_id = v_branch.institution_id
      AND lower(li.accession_no) = lower(v_accession_no)
  ) THEN
    RAISE EXCEPTION 'Accession number % already exists in this institution', v_accession_no;
  END IF;

  IF v_isbn_13 IS NOT NULL THEN
    SELECT id INTO v_book_id
    FROM public.library_books
    WHERE regexp_replace(coalesce(isbn_13, ''), '[^0-9]', '', 'g') = v_isbn_13
    LIMIT 1;
  END IF;

  IF v_book_id IS NULL AND v_isbn_10 IS NOT NULL THEN
    SELECT id INTO v_book_id
    FROM public.library_books
    WHERE regexp_replace(coalesce(isbn_10, ''), '[^0-9Xx]', '', 'g') = v_isbn_10
    LIMIT 1;
  END IF;

  IF v_book_id IS NULL AND v_isbn = '' THEN
    SELECT id INTO v_book_id
    FROM public.library_books b
    WHERE lower(trim(b.title)) = lower(v_title)
      AND coalesce(lower(nullif(trim(b.edition), '')), '') = coalesce(lower(v_edition), '')
      AND (
        cardinality(v_authors) = 0
        OR cardinality(b.authors) = 0
        OR lower(b.authors[1]) = lower(v_authors[1])
      )
    ORDER BY b.created_at
    LIMIT 1;
  END IF;

  v_cover_url := nullif(v_metadata->>'cover_url', '');

  IF v_book_id IS NULL THEN
    INSERT INTO public.library_books (
      title, subtitle, authors, isbn_10, isbn_13, publisher, published_year,
      edition, pages, volume, place,
      language, category, subject, description, cover_url, metadata, created_by
    )
    VALUES (
      v_title,
      nullif(v_metadata->>'subtitle', ''),
      v_authors,
      v_isbn_10,
      v_isbn_13,
      v_publisher,
      coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
      v_edition,
      v_pages,
      v_volume,
      v_place,
      nullif(trim(coalesce(_language, v_record.language, v_metadata->>'language')), ''),
      nullif(trim(coalesce(_category, v_record.category, v_metadata->>'category')), ''),
      nullif(trim(coalesce(_subject, v_record.subject, v_metadata->>'subject')), ''),
      nullif(v_metadata->>'description', ''),
      v_cover_url,
      v_metadata,
      auth.uid()
    )
    RETURNING id INTO v_book_id;
  ELSE
    UPDATE public.library_books
    SET title = COALESCE(nullif(title, ''), v_title),
        authors = CASE WHEN cardinality(authors) = 0 AND cardinality(v_authors) > 0 THEN v_authors ELSE authors END,
        publisher = COALESCE(publisher, v_publisher),
        edition = COALESCE(edition, v_edition),
        pages = COALESCE(pages, v_pages),
        volume = COALESCE(volume, v_volume),
        place = COALESCE(place, v_place),
        cover_url = COALESCE(cover_url, v_cover_url),
        metadata = metadata || v_metadata,
        updated_at = now()
    WHERE id = v_book_id;
  END IF;

  -- Populate the reusable authors entity + refresh the denormalized authors[] cache.
  PERFORM public.library_sync_book_authors(v_book_id, v_authors);

  INSERT INTO public.library_items (
    book_id, branch_id, campus_id, institution_id, accession_no, barcode,
    shelf_location, rack, condition, source, purchase_price, created_by
  )
  VALUES (
    v_book_id,
    v_branch.id,
    v_branch.campus_id,
    v_branch.institution_id,
    v_accession_no,
    v_accession_no,
    nullif(trim(coalesce(_shelf_location, v_record.shelf_location)), ''),
    nullif(trim(coalesce(_rack, v_record.rack)), ''),
    coalesce(nullif(trim(coalesce(_condition, v_record.condition)), ''), 'good'),
    v_record.source,
    coalesce(_purchase_price, v_record.purchase_price),
    auth.uid()
  )
  RETURNING id INTO v_item_id;

  UPDATE public.library_digitization_records
  SET status = 'approved',
      accession_no = v_accession_no,
      title = v_title,
      authors_text = v_authors_text,
      isbn = nullif(v_isbn, ''),
      publisher = v_publisher,
      published_year = coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
      edition = v_edition,
      pages = v_pages,
      volume = v_volume,
      place = v_place,
      category = nullif(trim(coalesce(_category, v_record.category, v_metadata->>'category')), ''),
      subject = nullif(trim(coalesce(_subject, v_record.subject, v_metadata->>'subject')), ''),
      language = nullif(trim(coalesce(_language, v_record.language, v_metadata->>'language')), ''),
      shelf_location = nullif(trim(coalesce(_shelf_location, v_record.shelf_location)), ''),
      rack = nullif(trim(coalesce(_rack, v_record.rack)), ''),
      condition = coalesce(nullif(trim(coalesce(_condition, v_record.condition)), ''), 'good'),
      purchase_price = coalesce(_purchase_price, v_record.purchase_price),
      matched_book_id = v_book_id,
      approved_item_id = v_item_id,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = v_record.id;

  INSERT INTO public.library_audit_events (actor_id, action, entity_type, entity_id, branch_id, metadata)
  VALUES (
    auth.uid(),
    'digitization.approved',
    'library_digitization_record',
    v_record.id,
    v_branch.id,
    jsonb_build_object('book_id', v_book_id, 'item_id', v_item_id, 'accession_no', v_accession_no)
  );

  RETURN QUERY SELECT v_book_id, v_item_id, v_accession_no;
END;
$$;

-- Backfill: turn existing catalog authors[] into shared author entities + links.
INSERT INTO public.library_authors (name, normalized_name)
SELECT DISTINCT ON (public.library_normalize_name(a)) trim(a), public.library_normalize_name(a)
FROM public.library_books b, unnest(b.authors) AS a
WHERE nullif(trim(a), '') IS NOT NULL
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.library_book_authors (book_id, author_id, position)
SELECT b.id, la.id, t.ord
FROM public.library_books b,
     unnest(b.authors) WITH ORDINALITY AS t(a, ord)
JOIN public.library_authors la ON la.normalized_name = public.library_normalize_name(t.a)
WHERE nullif(trim(t.a), '') IS NOT NULL
ON CONFLICT (book_id, author_id) DO NOTHING;
