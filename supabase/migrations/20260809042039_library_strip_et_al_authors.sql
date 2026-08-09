-- "et al" / "etal" / "and others" are editorial markers meaning "and others" — not real authors.
-- Strip them so they never become author entities, wire the cleaner into upsert + approval, and
-- clean up any already-imported data.

CREATE OR REPLACE FUNCTION public.library_clean_author_name(_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(_name, ''), '[,\s]*\yet\.?\s*al\y\.?', '', 'gi'),
        '[,\s]*(and|&)\s+others\y', '', 'gi'
      ),
      ' ,'
    ),
    ''
  );
$$;
GRANT EXECUTE ON FUNCTION public.library_clean_author_name(text) TO authenticated;

-- Clean the name at the upsert chokepoint (covers approval, manual add, and any future caller).
CREATE OR REPLACE FUNCTION public.library_upsert_author(_name text, _threshold float DEFAULT 0.72)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean text;
  v_norm text;
  v_id uuid;
BEGIN
  v_clean := public.library_clean_author_name(_name);
  IF v_clean IS NULL THEN
    RETURN NULL;
  END IF;
  v_norm := public.library_normalize_name(v_clean);
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
  VALUES (v_clean, v_norm, auth.uid())
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Re-emit approval so the split author list + authors_text writeback are cleaned too.
CREATE OR REPLACE FUNCTION public.library_approve_digitization_record(
  _record_id uuid, _accession_no text DEFAULT NULL, _title text DEFAULT NULL, _authors_text text DEFAULT NULL,
  _isbn text DEFAULT NULL, _publisher text DEFAULT NULL, _published_year int DEFAULT NULL, _category text DEFAULT NULL,
  _subject text DEFAULT NULL, _language text DEFAULT NULL, _shelf_location text DEFAULT NULL, _rack text DEFAULT NULL,
  _condition text DEFAULT NULL, _purchase_price numeric DEFAULT NULL, _edition text DEFAULT NULL, _pages int DEFAULT NULL,
  _volume text DEFAULT NULL, _place text DEFAULT NULL
)
RETURNS TABLE(book_id uuid, item_id uuid, accession_no text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record public.library_digitization_records%ROWTYPE; v_branch public.library_branches%ROWTYPE;
  v_metadata jsonb; v_title text; v_authors_text text; v_authors text[]; v_isbn text; v_isbn_10 text; v_isbn_13 text;
  v_accession_no text; v_book_id uuid; v_item_id uuid; v_cover_url text; v_edition text; v_pages int; v_volume text; v_place text; v_publisher text;
BEGIN
  SELECT * INTO v_record FROM public.library_digitization_records WHERE id = _record_id FOR UPDATE;
  IF v_record.id IS NULL THEN RAISE EXCEPTION 'Digitization record not found'; END IF;
  IF v_record.branch_id IS NULL THEN RAISE EXCEPTION 'Digitization record is not linked to a library'; END IF;
  IF v_record.status = 'approved' THEN RAISE EXCEPTION 'Digitization record is already approved'; END IF;
  IF NOT public.library_user_can_access_branch(auth.uid(), v_record.branch_id, 'catalog') THEN
    RAISE EXCEPTION 'You do not have catalog access to this library'; END IF;
  SELECT * INTO v_branch FROM public.library_branches WHERE id = v_record.branch_id;
  v_metadata := COALESCE(v_record.suggested_metadata, '{}'::jsonb);
  v_title := nullif(trim(coalesce(_title, v_record.title, v_metadata->>'title')), '');
  IF v_title IS NULL THEN RAISE EXCEPTION 'Book title is required before approval'; END IF;
  v_authors_text := nullif(trim(coalesce(_authors_text, v_record.authors_text)), '');
  IF v_authors_text IS NULL AND jsonb_typeof(v_metadata->'authors') = 'array' THEN
    SELECT string_agg(value, ', ') INTO v_authors_text FROM jsonb_array_elements_text(v_metadata->'authors') AS value; END IF;
  -- Split, strip et-al markers, drop empties, then re-derive the cleaned authors_text.
  v_authors := ARRAY(
    SELECT c FROM (
      SELECT public.library_clean_author_name(trim(part)) AS c
      FROM regexp_split_to_table(coalesce(v_authors_text, ''), ',') AS part
    ) t WHERE nullif(c, '') IS NOT NULL
  );
  v_authors_text := nullif(array_to_string(v_authors, ', '), '');
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
    RAISE EXCEPTION 'Accession number % already exists in this institution', v_accession_no; END IF;
  IF v_isbn_13 IS NOT NULL THEN SELECT id INTO v_book_id FROM public.library_books WHERE regexp_replace(coalesce(isbn_13, ''), '[^0-9]', '', 'g') = v_isbn_13 LIMIT 1; END IF;
  IF v_book_id IS NULL AND v_isbn_10 IS NOT NULL THEN SELECT id INTO v_book_id FROM public.library_books WHERE regexp_replace(coalesce(isbn_10, ''), '[^0-9Xx]', '', 'g') = v_isbn_10 LIMIT 1; END IF;
  IF v_book_id IS NULL AND v_isbn = '' THEN
    SELECT id INTO v_book_id FROM public.library_books b
    WHERE lower(trim(b.title)) = lower(v_title)
      AND coalesce(lower(nullif(trim(b.edition), '')), '') = coalesce(lower(v_edition), '')
      AND (cardinality(v_authors) = 0 OR cardinality(b.authors) = 0 OR lower(b.authors[1]) = lower(v_authors[1]))
    ORDER BY b.created_at LIMIT 1; END IF;
  v_cover_url := coalesce(nullif(v_metadata->>'cover_url', ''), nullif(v_record.cover_image_url, ''));
  IF v_book_id IS NULL THEN
    INSERT INTO public.library_books (title, subtitle, authors, isbn_10, isbn_13, publisher, published_year,
      edition, pages, volume, place, language, category, subject, description, cover_url, metadata, created_by)
    VALUES (v_title, nullif(v_metadata->>'subtitle', ''), v_authors, v_isbn_10, v_isbn_13, v_publisher,
      coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
      v_edition, v_pages, v_volume, v_place,
      nullif(trim(coalesce(_language, v_record.language, v_metadata->>'language')), ''),
      nullif(trim(coalesce(_category, v_record.category, v_metadata->>'category')), ''),
      nullif(trim(coalesce(_subject, v_record.subject, v_metadata->>'subject')), ''),
      nullif(v_metadata->>'description', ''), v_cover_url, v_metadata, auth.uid())
    RETURNING id INTO v_book_id;
  ELSE
    UPDATE public.library_books
    SET title = COALESCE(nullif(title, ''), v_title),
        authors = CASE WHEN cardinality(authors) = 0 AND cardinality(v_authors) > 0 THEN v_authors ELSE authors END,
        publisher = COALESCE(publisher, v_publisher), edition = COALESCE(edition, v_edition),
        pages = COALESCE(pages, v_pages), volume = COALESCE(volume, v_volume), place = COALESCE(place, v_place),
        cover_url = COALESCE(cover_url, v_cover_url), metadata = metadata || v_metadata, updated_at = now()
    WHERE id = v_book_id; END IF;
  PERFORM public.library_sync_book_authors(v_book_id, v_authors);
  PERFORM public.library_sync_book_publisher(v_book_id, v_publisher);
  INSERT INTO public.library_items (book_id, branch_id, campus_id, institution_id, accession_no, barcode,
    shelf_location, rack, condition, source, purchase_price, created_by)
  VALUES (v_book_id, v_branch.id, v_branch.campus_id, v_branch.institution_id, v_accession_no, v_accession_no,
    nullif(trim(coalesce(_shelf_location, v_record.shelf_location)), ''), nullif(trim(coalesce(_rack, v_record.rack)), ''),
    coalesce(nullif(trim(coalesce(_condition, v_record.condition)), ''), 'good'),
    v_record.source, coalesce(_purchase_price, v_record.purchase_price), auth.uid())
  RETURNING id INTO v_item_id;
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
      matched_book_id = v_book_id, approved_item_id = v_item_id, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id = v_record.id;
  INSERT INTO public.library_audit_events (actor_id, action, entity_type, entity_id, branch_id, metadata)
  VALUES (auth.uid(), 'digitization.approved', 'library_digitization_record', v_record.id, v_branch.id,
          jsonb_build_object('book_id', v_book_id, 'item_id', v_item_id, 'accession_no', v_accession_no));
  RETURN QUERY SELECT v_book_id, v_item_id, v_accession_no;
END; $$;

-- Backfill 1: clean authors_text on already-imported digitization records that still contain markers.
UPDATE public.library_digitization_records
SET authors_text = public.library_clean_author_name(authors_text)
WHERE authors_text ~* '\yet\.?\s*al\y' OR authors_text ~* '(and|&)\s+others\y';

-- Backfill 2: fix any author entities already created from markers.
-- 2a: authors that are PURELY a marker -> drop (cascades their book links; caches rebuilt in 2c).
DELETE FROM public.library_authors WHERE public.library_clean_author_name(name) IS NULL;
-- 2b: authors with a marker suffix ("Taylor et al") -> rename to the clean form, merging on collision.
DO $$
DECLARE r record; v_norm text; v_existing uuid;
BEGIN
  FOR r IN SELECT id, name FROM public.library_authors WHERE public.library_clean_author_name(name) <> name LOOP
    v_norm := public.library_normalize_name(public.library_clean_author_name(r.name));
    SELECT id INTO v_existing FROM public.library_authors WHERE normalized_name = v_norm AND id <> r.id LIMIT 1;
    IF v_existing IS NOT NULL THEN
      UPDATE public.library_book_authors ba SET author_id = v_existing
      WHERE ba.author_id = r.id
        AND NOT EXISTS (SELECT 1 FROM public.library_book_authors k WHERE k.book_id = ba.book_id AND k.author_id = v_existing);
      DELETE FROM public.library_book_authors WHERE author_id = r.id;
      DELETE FROM public.library_authors WHERE id = r.id;
    ELSE
      UPDATE public.library_authors SET name = public.library_clean_author_name(r.name), normalized_name = v_norm, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
-- 2c: rebuild the denormalized authors[] cache on every affected book from the (now clean) join.
UPDATE public.library_books b
SET authors = COALESCE(
  (SELECT array_agg(a.name ORDER BY ba.position NULLS LAST, a.name)
   FROM public.library_book_authors ba JOIN public.library_authors a ON a.id = ba.author_id
   WHERE ba.book_id = b.id), '{}'::text[])
WHERE EXISTS (SELECT 1 FROM unnest(b.authors) x WHERE x ~* '\yet\.?\s*al\y' OR x ~* '(and|&)\s+others\y');
