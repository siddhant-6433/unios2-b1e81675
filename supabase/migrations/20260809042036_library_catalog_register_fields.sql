-- Register-import fields: pages/volume/place on the catalog, edition/pages/volume/place on the
-- digitization staging table, and an approval RPC that (a) writes edition/pages/volume/place
-- (edition was silently dropped before) and (b) merges copies — when a record has no ISBN,
-- reuse an existing catalog title matched by title+edition+first-author so N register rows for the
-- same book become one library_books row with N library_items copies (each its own accession).

ALTER TABLE public.library_books
  ADD COLUMN IF NOT EXISTS pages int,
  ADD COLUMN IF NOT EXISTS volume text,
  ADD COLUMN IF NOT EXISTS place text;

ALTER TABLE public.library_digitization_records
  ADD COLUMN IF NOT EXISTS edition text,
  ADD COLUMN IF NOT EXISTS pages int,
  ADD COLUMN IF NOT EXISTS volume text,
  ADD COLUMN IF NOT EXISTS place text;

-- Adding params changes the signature -> drop the old overload so calls stay unambiguous.
DROP FUNCTION IF EXISTS public.library_approve_digitization_record(
  uuid, text, text, text, text, text, int, text, text, text, text, text, text, numeric);

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

  -- Copy-merge for ISBN-less register rows: reuse an existing title matched by
  -- title + edition + first author, so repeated register rows become extra copies.
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

GRANT EXECUTE ON FUNCTION public.library_approve_digitization_record(
  uuid, text, text, text, text, text, int, text, text, text, text, text, text, numeric, text, int, text, text
) TO authenticated;
