-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807125411 name=library_publishers_entity applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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

CREATE OR REPLACE FUNCTION public.library_upsert_publisher(_name text, _threshold float DEFAULT 0.72)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_norm text; v_id uuid;
BEGIN
  v_norm := public.library_normalize_name(_name);
  IF v_norm = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.library_publishers WHERE normalized_name = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_id FROM public.library_publishers
  WHERE similarity(normalized_name, v_norm) >= _threshold
  ORDER BY similarity(normalized_name, v_norm) DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.library_publishers (name, normalized_name, created_by)
  VALUES (trim(_name), v_norm, auth.uid())
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.library_sync_book_publisher(_book_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  IF _book_id IS NULL THEN RETURN; END IF;
  IF nullif(trim(coalesce(_name, '')), '') IS NULL THEN RETURN; END IF;
  v_id := public.library_upsert_publisher(_name);
  UPDATE public.library_books
  SET publisher_id = v_id,
      publisher = (SELECT name FROM public.library_publishers WHERE id = v_id),
      updated_at = now()
  WHERE id = _book_id;
END; $$;

CREATE OR REPLACE FUNCTION public.library_merge_publishers(_keep uuid, _merge uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_keep_name text;
BEGIN
  IF NOT public.can_operate_library() THEN RAISE EXCEPTION 'You do not have permission to manage publishers'; END IF;
  IF _keep IS NULL OR _merge IS NULL THEN RETURN; END IF;
  SELECT name INTO v_keep_name FROM public.library_publishers WHERE id = _keep;
  UPDATE public.library_books SET publisher_id = _keep, publisher = v_keep_name, updated_at = now()
  WHERE publisher_id = ANY(_merge) AND publisher_id <> _keep;
  DELETE FROM public.library_publishers WHERE id = ANY(_merge) AND id <> _keep;
END; $$;

CREATE OR REPLACE FUNCTION public.library_publisher_duplicate_pairs(_threshold float DEFAULT 0.5)
RETURNS TABLE(id_a uuid, name_a text, id_b uuid, name_b text, sim float)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT a.id, a.name, b.id, b.name, similarity(a.normalized_name, b.normalized_name)::float
  FROM public.library_publishers a
  JOIN public.library_publishers b ON a.id < b.id
  WHERE a.normalized_name % b.normalized_name
    AND similarity(a.normalized_name, b.normalized_name) >= _threshold
  ORDER BY 5 DESC LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.library_list_publishers(_search text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS TABLE(id uuid, name text, book_count bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.name, count(b.id) AS book_count
  FROM public.library_publishers p
  LEFT JOIN public.library_books b ON b.publisher_id = p.id
  WHERE _search IS NULL OR p.name ILIKE '%' || _search || '%'
  GROUP BY p.id, p.name
  ORDER BY count(b.id) DESC, p.name
  LIMIT greatest(_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.library_rename_publisher(_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_norm text; v_existing uuid;
BEGIN
  IF NOT public.can_operate_library() THEN RAISE EXCEPTION 'You do not have permission to manage publishers'; END IF;
  v_norm := public.library_normalize_name(_name);
  IF v_norm = '' THEN RAISE EXCEPTION 'Publisher name cannot be empty'; END IF;
  SELECT id INTO v_existing FROM public.library_publishers WHERE normalized_name = v_norm AND id <> _id LIMIT 1;
  IF v_existing IS NOT NULL THEN PERFORM public.library_merge_publishers(v_existing, ARRAY[_id]); RETURN; END IF;
  UPDATE public.library_publishers SET name = trim(_name), normalized_name = v_norm, updated_at = now() WHERE id = _id;
  UPDATE public.library_books SET publisher = trim(_name), updated_at = now() WHERE publisher_id = _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.library_upsert_publisher(text, float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_sync_book_publisher(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_merge_publishers(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_publisher_duplicate_pairs(float) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_list_publishers(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_rename_publisher(uuid, text) TO authenticated;

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
