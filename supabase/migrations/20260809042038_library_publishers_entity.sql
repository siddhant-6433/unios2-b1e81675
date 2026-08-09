-- Publishers as a reusable entity (mirror of library_authors), so variants like "Jaypee bro"/
-- "Jaypee Brothers" or "AITBS Pub"/"AITBS Pub. Delhi" can be shared and merged. Publisher is a
-- single scalar per book, so it links via a direct FK (library_books.publisher_id); the existing
-- library_books.publisher text stays as a denormalized display cache, kept in sync.

CREATE TABLE IF NOT EXISTS public.library_publishers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_publishers_normalized ON public.library_publishers (normalized_name);
CREATE INDEX IF NOT EXISTS idx_library_publishers_trgm ON public.library_publishers USING gin (normalized_name extensions.gin_trgm_ops);

ALTER TABLE public.library_books
  ADD COLUMN IF NOT EXISTS publisher_id uuid REFERENCES public.library_publishers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_library_books_publisher_id ON public.library_books (publisher_id);

ALTER TABLE public.library_publishers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users discover library publishers" ON public.library_publishers;
CREATE POLICY "Authenticated users discover library publishers" ON public.library_publishers
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Library staff manage publishers" ON public.library_publishers;
CREATE POLICY "Library staff manage publishers" ON public.library_publishers
  FOR ALL TO authenticated USING (public.can_operate_library()) WITH CHECK (public.can_operate_library());

-- Reuse existing generic public.library_normalize_name(text) from the authors migration.

CREATE OR REPLACE FUNCTION public.library_upsert_publisher(_name text, _threshold float DEFAULT 0.72)
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

  SELECT id INTO v_id FROM public.library_publishers WHERE normalized_name = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT id INTO v_id
  FROM public.library_publishers
  WHERE similarity(normalized_name, v_norm) >= _threshold
  ORDER BY similarity(normalized_name, v_norm) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.library_publishers (name, normalized_name, created_by)
  VALUES (trim(_name), v_norm, auth.uid())
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Resolve a publisher name to an entity and set both the FK and the denormalized text cache.
CREATE OR REPLACE FUNCTION public.library_sync_book_publisher(_book_id uuid, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _book_id IS NULL THEN
    RETURN;
  END IF;
  IF nullif(trim(coalesce(_name, '')), '') IS NULL THEN
    RETURN; -- leave existing publisher untouched when no name supplied
  END IF;
  v_id := public.library_upsert_publisher(_name);
  UPDATE public.library_books
  SET publisher_id = v_id,
      publisher = (SELECT name FROM public.library_publishers WHERE id = v_id),
      updated_at = now()
  WHERE id = _book_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_merge_publishers(_keep uuid, _merge uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_keep_name text;
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage publishers';
  END IF;
  IF _keep IS NULL OR _merge IS NULL THEN
    RETURN;
  END IF;

  SELECT name INTO v_keep_name FROM public.library_publishers WHERE id = _keep;

  UPDATE public.library_books
  SET publisher_id = _keep, publisher = v_keep_name, updated_at = now()
  WHERE publisher_id = ANY(_merge) AND publisher_id <> _keep;

  DELETE FROM public.library_publishers WHERE id = ANY(_merge) AND id <> _keep;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_publisher_duplicate_pairs(_threshold float DEFAULT 0.5)
RETURNS TABLE(id_a uuid, name_a text, id_b uuid, name_b text, sim float)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT a.id, a.name, b.id, b.name, similarity(a.normalized_name, b.normalized_name)::float
  FROM public.library_publishers a
  JOIN public.library_publishers b ON a.id < b.id
  WHERE a.normalized_name % b.normalized_name
    AND similarity(a.normalized_name, b.normalized_name) >= _threshold
  ORDER BY 5 DESC
  LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.library_list_publishers(_search text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS TABLE(id uuid, name text, book_count bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p.id, p.name, count(b.id) AS book_count
  FROM public.library_publishers p
  LEFT JOIN public.library_books b ON b.publisher_id = p.id
  WHERE _search IS NULL OR p.name ILIKE '%' || _search || '%'
  GROUP BY p.id, p.name
  ORDER BY count(b.id) DESC, p.name
  LIMIT greatest(_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.library_rename_publisher(_id uuid, _name text)
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
    RAISE EXCEPTION 'You do not have permission to manage publishers';
  END IF;
  v_norm := public.library_normalize_name(_name);
  IF v_norm = '' THEN
    RAISE EXCEPTION 'Publisher name cannot be empty';
  END IF;
  SELECT id INTO v_existing FROM public.library_publishers WHERE normalized_name = v_norm AND id <> _id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM public.library_merge_publishers(v_existing, ARRAY[_id]);
    RETURN;
  END IF;
  UPDATE public.library_publishers SET name = trim(_name), normalized_name = v_norm, updated_at = now() WHERE id = _id;
  UPDATE public.library_books SET publisher = trim(_name), updated_at = now() WHERE publisher_id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.library_upsert_publisher(text, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_sync_book_publisher(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_merge_publishers(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_publisher_duplicate_pairs(float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_list_publishers(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_rename_publisher(uuid, text) TO authenticated;

-- Wire publisher-entity resolution into approval (adds one PERFORM after the author sync).
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
  SELECT * INTO v_record FROM public.library_digitization_records WHERE id = _record_id FOR UPDATE;
  IF v_record.id IS NULL THEN RAISE EXCEPTION 'Digitization record not found'; END IF;
  IF v_record.branch_id IS NULL THEN RAISE EXCEPTION 'Digitization record is not linked to a library'; END IF;
  IF v_record.status = 'approved' THEN RAISE EXCEPTION 'Digitization record is already approved'; END IF;
  IF NOT public.library_user_can_access_branch(auth.uid(), v_record.branch_id, 'catalog') THEN
    RAISE EXCEPTION 'You do not have catalog access to this library';
  END IF;

  SELECT * INTO v_branch FROM public.library_branches WHERE id = v_record.branch_id;

  v_metadata := COALESCE(v_record.suggested_metadata, '{}'::jsonb);
  v_title := nullif(trim(coalesce(_title, v_record.title, v_metadata->>'title')), '');
  IF v_title IS NULL THEN RAISE EXCEPTION 'Book title is required before approval'; END IF;

  v_authors_text := nullif(trim(coalesce(_authors_text, v_record.authors_text)), '');
  IF v_authors_text IS NULL AND jsonb_typeof(v_metadata->'authors') = 'array' THEN
    SELECT string_agg(value, ', ') INTO v_authors_text FROM jsonb_array_elements_text(v_metadata->'authors') AS value;
  END IF;
  v_authors := CASE
    WHEN v_authors_text IS NULL THEN ARRAY[]::text[]
    ELSE ARRAY(SELECT trim(part) FROM regexp_split_to_table(v_authors_text, ',') AS part WHERE trim(part) <> '')
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
  IF v_accession_no IS NULL THEN v_accession_no := public.library_next_accession_no(v_record.branch_id, null); END IF;

  IF EXISTS (SELECT 1 FROM public.library_items li WHERE li.institution_id = v_branch.institution_id AND lower(li.accession_no) = lower(v_accession_no)) THEN
    RAISE EXCEPTION 'Accession number % already exists in this institution', v_accession_no;
  END IF;

  IF v_isbn_13 IS NOT NULL THEN
    SELECT id INTO v_book_id FROM public.library_books WHERE regexp_replace(coalesce(isbn_13, ''), '[^0-9]', '', 'g') = v_isbn_13 LIMIT 1;
  END IF;
  IF v_book_id IS NULL AND v_isbn_10 IS NOT NULL THEN
    SELECT id INTO v_book_id FROM public.library_books WHERE regexp_replace(coalesce(isbn_10, ''), '[^0-9Xx]', '', 'g') = v_isbn_10 LIMIT 1;
  END IF;
  IF v_book_id IS NULL AND v_isbn = '' THEN
    SELECT id INTO v_book_id FROM public.library_books b
    WHERE lower(trim(b.title)) = lower(v_title)
      AND coalesce(lower(nullif(trim(b.edition), '')), '') = coalesce(lower(v_edition), '')
      AND (cardinality(v_authors) = 0 OR cardinality(b.authors) = 0 OR lower(b.authors[1]) = lower(v_authors[1]))
    ORDER BY b.created_at LIMIT 1;
  END IF;

  v_cover_url := coalesce(nullif(v_metadata->>'cover_url', ''), nullif(v_record.cover_image_url, ''));

  IF v_book_id IS NULL THEN
    INSERT INTO public.library_books (
      title, subtitle, authors, isbn_10, isbn_13, publisher, published_year,
      edition, pages, volume, place,
      language, category, subject, description, cover_url, metadata, created_by
    ) VALUES (
      v_title, nullif(v_metadata->>'subtitle', ''), v_authors, v_isbn_10, v_isbn_13, v_publisher,
      coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
      v_edition, v_pages, v_volume, v_place,
      nullif(trim(coalesce(_language, v_record.language, v_metadata->>'language')), ''),
      nullif(trim(coalesce(_category, v_record.category, v_metadata->>'category')), ''),
      nullif(trim(coalesce(_subject, v_record.subject, v_metadata->>'subject')), ''),
      nullif(v_metadata->>'description', ''), v_cover_url, v_metadata, auth.uid()
    ) RETURNING id INTO v_book_id;
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

  PERFORM public.library_sync_book_authors(v_book_id, v_authors);
  PERFORM public.library_sync_book_publisher(v_book_id, v_publisher);

  INSERT INTO public.library_items (
    book_id, branch_id, campus_id, institution_id, accession_no, barcode,
    shelf_location, rack, condition, source, purchase_price, created_by
  ) VALUES (
    v_book_id, v_branch.id, v_branch.campus_id, v_branch.institution_id, v_accession_no, v_accession_no,
    nullif(trim(coalesce(_shelf_location, v_record.shelf_location)), ''),
    nullif(trim(coalesce(_rack, v_record.rack)), ''),
    coalesce(nullif(trim(coalesce(_condition, v_record.condition)), ''), 'good'),
    v_record.source, coalesce(_purchase_price, v_record.purchase_price), auth.uid()
  ) RETURNING id INTO v_item_id;

  UPDATE public.library_digitization_records
  SET status = 'approved', accession_no = v_accession_no, title = v_title, authors_text = v_authors_text,
      isbn = nullif(v_isbn, ''), publisher = v_publisher,
      published_year = coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
      edition = v_edition, pages = v_pages, volume = v_volume, place = v_place,
      category = nullif(trim(coalesce(_category, v_record.category, v_metadata->>'category')), ''),
      subject = nullif(trim(coalesce(_subject, v_record.subject, v_metadata->>'subject')), ''),
      language = nullif(trim(coalesce(_language, v_record.language, v_metadata->>'language')), ''),
      shelf_location = nullif(trim(coalesce(_shelf_location, v_record.shelf_location)), ''),
      rack = nullif(trim(coalesce(_rack, v_record.rack)), ''),
      condition = coalesce(nullif(trim(coalesce(_condition, v_record.condition)), ''), 'good'),
      purchase_price = coalesce(_purchase_price, v_record.purchase_price),
      matched_book_id = v_book_id, approved_item_id = v_item_id,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = v_record.id;

  INSERT INTO public.library_audit_events (actor_id, action, entity_type, entity_id, branch_id, metadata)
  VALUES (auth.uid(), 'digitization.approved', 'library_digitization_record', v_record.id, v_branch.id,
          jsonb_build_object('book_id', v_book_id, 'item_id', v_item_id, 'accession_no', v_accession_no));

  RETURN QUERY SELECT v_book_id, v_item_id, v_accession_no;
END;
$$;

-- Backfill publisher entities from existing catalog publisher strings + link books.
INSERT INTO public.library_publishers (name, normalized_name)
SELECT DISTINCT ON (public.library_normalize_name(publisher)) trim(publisher), public.library_normalize_name(publisher)
FROM public.library_books
WHERE nullif(trim(coalesce(publisher, '')), '') IS NOT NULL
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE public.library_books b
SET publisher_id = p.id
FROM public.library_publishers p
WHERE p.normalized_name = public.library_normalize_name(b.publisher)
  AND b.publisher_id IS NULL
  AND nullif(trim(coalesce(b.publisher, '')), '') IS NOT NULL;
