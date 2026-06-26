-- Library digitization approval, Excel import staging, and accession generation.

ALTER TABLE public.library_digitization_records
  ADD COLUMN IF NOT EXISTS accession_no text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS authors_text text,
  ADD COLUMN IF NOT EXISTS publisher text,
  ADD COLUMN IF NOT EXISTS published_year int,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS shelf_location text,
  ADD COLUMN IF NOT EXISTS rack text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS import_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_item_id uuid REFERENCES public.library_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_library_digitization_records_branch_status
  ON public.library_digitization_records(branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_digitization_records_accession
  ON public.library_digitization_records(branch_id, accession_no)
  WHERE accession_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.library_next_accession_no(
  _branch_id uuid,
  _prefix text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch public.library_branches%ROWTYPE;
  v_prefix text;
  v_next int;
BEGIN
  SELECT * INTO v_branch
  FROM public.library_branches
  WHERE id = _branch_id;

  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'Library not found';
  END IF;

  v_prefix := upper(regexp_replace(coalesce(nullif(trim(_prefix), ''), nullif(trim(v_branch.code), ''), left(v_branch.name, 3), 'LIB'), '[^A-Za-z0-9]+', '', 'g'));
  IF v_prefix = '' THEN
    v_prefix := 'LIB';
  END IF;

  SELECT COALESCE(MAX(substring(accession_no FROM '([0-9]+)$')::int), 0) + 1
    INTO v_next
  FROM public.library_items
  WHERE institution_id = v_branch.institution_id
    AND substring(accession_no FROM '([0-9]+)$') IS NOT NULL;

  RETURN v_prefix || '-' || lpad(v_next::text, 6, '0');
END;
$$;

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
  _purchase_price numeric DEFAULT NULL
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

  v_cover_url := nullif(v_metadata->>'cover_url', '');

  IF v_book_id IS NULL THEN
    INSERT INTO public.library_books (
      title,
      subtitle,
      authors,
      isbn_10,
      isbn_13,
      publisher,
      published_year,
      language,
      category,
      subject,
      description,
      cover_url,
      metadata,
      created_by
    )
    VALUES (
      v_title,
      nullif(v_metadata->>'subtitle', ''),
      v_authors,
      v_isbn_10,
      v_isbn_13,
      nullif(trim(coalesce(_publisher, v_record.publisher, v_metadata->>'publisher')), ''),
      coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
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
        publisher = COALESCE(publisher, nullif(trim(coalesce(_publisher, v_record.publisher, v_metadata->>'publisher')), '')),
        cover_url = COALESCE(cover_url, v_cover_url),
        metadata = metadata || v_metadata,
        updated_at = now()
    WHERE id = v_book_id;
  END IF;

  INSERT INTO public.library_items (
    book_id,
    branch_id,
    campus_id,
    institution_id,
    accession_no,
    barcode,
    shelf_location,
    rack,
    condition,
    source,
    purchase_price,
    created_by
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
      publisher = nullif(trim(coalesce(_publisher, v_record.publisher, v_metadata->>'publisher')), ''),
      published_year = coalesce(_published_year, v_record.published_year, nullif(v_metadata->>'published_year', '')::int),
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

CREATE OR REPLACE FUNCTION public.library_mark_digitization_duplicate(
  _record_id uuid,
  _duplicate_of uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.library_digitization_records%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM public.library_digitization_records
  WHERE id = _record_id;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'Digitization record not found';
  END IF;
  IF v_record.branch_id IS NULL OR NOT public.library_user_can_access_branch(auth.uid(), v_record.branch_id, 'digitize') THEN
    RAISE EXCEPTION 'You do not have digitization access to this library';
  END IF;

  UPDATE public.library_digitization_records
  SET status = 'duplicate',
      duplicate_of = _duplicate_of,
      notes = nullif(trim(_notes), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _record_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_reject_digitization_record(
  _record_id uuid,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.library_digitization_records%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM public.library_digitization_records
  WHERE id = _record_id;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'Digitization record not found';
  END IF;
  IF v_record.branch_id IS NULL OR NOT public.library_user_can_access_branch(auth.uid(), v_record.branch_id, 'digitize') THEN
    RAISE EXCEPTION 'You do not have digitization access to this library';
  END IF;

  UPDATE public.library_digitization_records
  SET status = 'rejected',
      notes = nullif(trim(_notes), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _record_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.library_next_accession_no(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_approve_digitization_record(uuid, text, text, text, text, text, int, text, text, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_mark_digitization_duplicate(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_reject_digitization_record(uuid, text) TO authenticated;
