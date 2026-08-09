-- Publisher variants in the registers embed place + boilerplate ("jaypee bro Pub Delhi",
-- "N. Delhi jaypee Pub", "Jaypee") so plain trigram matching never clustered them. Key publisher
-- matching on a stripped core (drop place names + publishing boilerplate, sort remaining tokens) so
-- all variants of a house collapse to ONE entity on approval.
-- ponytail: heuristic stop-word list; a genuinely two-word house sharing one token after stripping
-- (e.g. "S. Chand" vs "Chand & Co") stays separate — the Publishers merge UI handles the tail.

CREATE OR REPLACE FUNCTION public.library_normalize_publisher(_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH base AS (
    SELECT regexp_replace(lower(trim(coalesce(_name, ''))), '[^a-z0-9 ]', ' ', 'g') AS s
  ),
  toks AS (
    SELECT unnest(string_to_array(regexp_replace((SELECT s FROM base), '\s+', ' ', 'g'), ' ')) AS t
  ),
  filtered AS (
    SELECT t FROM toks
    WHERE t <> '' AND t NOT IN (
      'pub','pubs','publication','publications','publisher','publishers','publishing','pvt','ltd','limited',
      'bro','bros','brother','brothers','house','book','books','co','company','and','the','of','inc','press','media',
      'new','delhi','ndelhi','n','newdelhi','jaipur','mumbai','bombay','kolkata','calcutta','chennai',
      'madras','bangalore','bengaluru','hyderabad','lucknow','agra','noida','india','indian'
    )
  )
  SELECT nullif(string_agg(t, ' ' ORDER BY t), '') FROM filtered;
$$;
GRANT EXECUTE ON FUNCTION public.library_normalize_publisher(text) TO authenticated;

-- Match publishers on the stripped core (fall back to the generic normalizer if stripping empties it).
CREATE OR REPLACE FUNCTION public.library_upsert_publisher(_name text, _threshold float DEFAULT 0.72)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_norm text; v_id uuid;
BEGIN
  v_norm := coalesce(public.library_normalize_publisher(_name), public.library_normalize_name(_name));
  IF v_norm IS NULL OR v_norm = '' THEN RETURN NULL; END IF;
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

CREATE OR REPLACE FUNCTION public.library_rename_publisher(_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_norm text; v_existing uuid;
BEGIN
  IF NOT public.can_operate_library() THEN RAISE EXCEPTION 'You do not have permission to manage publishers'; END IF;
  v_norm := coalesce(public.library_normalize_publisher(_name), public.library_normalize_name(_name));
  IF v_norm IS NULL OR v_norm = '' THEN RAISE EXCEPTION 'Publisher name cannot be empty'; END IF;
  SELECT id INTO v_existing FROM public.library_publishers WHERE normalized_name = v_norm AND id <> _id LIMIT 1;
  IF v_existing IS NOT NULL THEN PERFORM public.library_merge_publishers(v_existing, ARRAY[_id]); RETURN; END IF;
  UPDATE public.library_publishers SET name = trim(_name), normalized_name = v_norm, updated_at = now() WHERE id = _id;
  UPDATE public.library_books SET publisher = trim(_name), updated_at = now() WHERE publisher_id = _id;
END; $$;

-- Re-normalize existing publisher entities under the new key, merging rows that now collide
-- (repoint their books to the surviving row, delete the duplicates).
DO $$
DECLARE r record; canonical uuid;
BEGIN
  FOR r IN
    SELECT coalesce(public.library_normalize_publisher(name), public.library_normalize_name(name)) AS newkey,
           array_agg(id ORDER BY created_at) AS ids
    FROM public.library_publishers
    WHERE coalesce(public.library_normalize_publisher(name), public.library_normalize_name(name)) IS NOT NULL
    GROUP BY 1
  LOOP
    canonical := r.ids[1];
    UPDATE public.library_books SET publisher_id = canonical
      WHERE publisher_id = ANY(r.ids) AND publisher_id <> canonical;
    DELETE FROM public.library_publishers WHERE id = ANY(r.ids) AND id <> canonical;
    UPDATE public.library_publishers SET normalized_name = r.newkey WHERE id = canonical;
  END LOOP;
END $$;
