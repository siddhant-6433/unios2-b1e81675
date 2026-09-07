-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807115238 name=library_authors_entity applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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

CREATE OR REPLACE FUNCTION public.library_normalize_name(_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(lower(trim(coalesce(_name, ''))), '\s+', ' ', 'g');
$$;

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

GRANT EXECUTE ON FUNCTION public.library_normalize_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_upsert_author(text, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_sync_book_authors(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_merge_authors(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_author_duplicate_pairs(float) TO authenticated;

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
