-- keep-migration-version: already applied and recorded on production schema_migrations
-- Applied as version 20260923044733; git must keep this timestamp for `db push`.
--
-- Publisher canonicalisation.
--
-- The imported registers contain 700+ distinct publisher strings that are mostly
-- shorthands and typos of a handful of houses (JPB / JBP / jaypee / jayee → Jaypee
-- Brothers; EBC / easterm / b c e → Eastern Book Company; AIR / all reporter →
-- All India Reporter; CBS / cbspd → CBS Publishers; …). The token normaliser in
-- 20260808060813 cannot bridge those, so every variant became its own publisher.
--
-- This adds an explicit alias dictionary (normalized key → canonical name) plus a
-- resolve-at-write path, a bulk backfill, and a review surface for the long tail.

-- ---------------------------------------------------------------------------
-- 1. Alias dictionary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_publisher_aliases (
  alias_norm text PRIMARY KEY,
  canonical_name text NOT NULL,
  canonical_norm text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_publisher_aliases_canonical
  ON public.library_publisher_aliases (canonical_norm);

ALTER TABLE public.library_publisher_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users discover publisher aliases" ON public.library_publisher_aliases;
CREATE POLICY "Authenticated users discover publisher aliases" ON public.library_publisher_aliases
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Library staff manage publisher aliases" ON public.library_publisher_aliases;
CREATE POLICY "Library staff manage publisher aliases" ON public.library_publisher_aliases
  FOR ALL TO authenticated
  USING (public.can_operate_library())
  WITH CHECK (public.can_operate_library());

-- ---------------------------------------------------------------------------
-- 2. Seed the dictionary from the actual register variants.
--    alias_norm is the output of library_normalize_publisher(), so lookups match.
-- ---------------------------------------------------------------------------
INSERT INTO public.library_publisher_aliases (alias_norm, canonical_name, canonical_norm)
SELECT DISTINCT ON (s.alias_norm) s.alias_norm, s.canonical_name, s.canonical_norm
FROM (
  SELECT
    public.library_normalize_publisher(v.alias) AS alias_norm,
    v.canonical AS canonical_name,
    coalesce(public.library_normalize_publisher(v.canonical), public.library_normalize_name(v.canonical)) AS canonical_norm
  FROM (VALUES
  -- Jaypee family
  ('JPB', 'Jaypee Brothers Medical Publishers'),
  ('jbp', 'Jaypee Brothers Medical Publishers'),
  ('jay pee', 'Jaypee Brothers Medical Publishers'),
  ('jayee', 'Jaypee Brothers Medical Publishers'),
  ('japee', 'Jaypee Brothers Medical Publishers'),
  ('jaypee', 'Jaypee Brothers Medical Publishers'),
  -- CBS
  ('cbs', 'CBS Publishers & Distributors'),
  ('cbspd', 'CBS Publishers & Distributors'),
  ('cbs d', 'CBS Publishers & Distributors'),
  -- AITBS
  ('aitbs', 'AITBS Publishers'),
  ('a ltbs', 'AITBS Publishers'),
  -- Eastern Book Company
  ('ebc', 'Eastern Book Company'),
  ('easterm', 'Eastern Book Company'),
  ('eastern', 'Eastern Book Company'),
  ('b c e', 'Eastern Book Company'),
  ('comp eastern', 'Eastern Book Company'),
  -- All India Reporter
  ('air', 'All India Reporter'),
  ('all reporter', 'All India Reporter'),
  ('all nagpur reporter', 'All India Reporter'),
  ('air d l t', 'All India Reporter'),
  -- Madras Law Journal
  ('jounal law', 'Madras Law Journal Publications'),
  ('journal law', 'Madras Law Journal Publications'),
  -- Universal Law
  ('law universal', 'Universal Law Publishing'),
  ('law univesal', 'Universal Law Publishing'),
  ('universal', 'Universal Law Publishing'),
  -- Central Law
  ('central law', 'Central Law Publications'),
  -- Avichal
  ('avichal', 'Avichal Publishing Company'),
  ('avichal publi', 'Avichal Publishing Company'),
  -- Pragati
  ('meerut pragati', 'Pragati Prakashan'),
  -- Lotus
  ('lotus', 'Lotus Press'),
  ('jalandhar lotus', 'Lotus Press'),
  ('lotus punjab', 'Lotus Press'),
  ('d lotus', 'Lotus Press'),
  ('punjab lotus', 'Lotus Press'),
  -- Pearson
  ('pearson', 'Pearson Education'),
  ('education pearson', 'Pearson Education'),
  -- Vikas
  ('unlimited vikas', 'Vikas Publishing House'),
  ('comany s vikas', 'Vikas Publishing House'),
  ('comp s vikas', 'Vikas Publishing House'),
  ('h vikas', 'Vikas Publishing House'),
  ('punjab s vikash', 'Vikas Publishing House'),
  ('jalandhar s vikash', 'Vikas Publishing House'),
  ('punjab s vikas', 'Vikas Publishing House'),
  -- McGraw Hill
  ('hill mcgraw tata', 'McGraw Hill Education'),
  ('mcgrahill tata', 'McGraw Hill Education'),
  -- Wolters Kluwer
  ('kluwer wolter', 'Wolters Kluwer'),
  -- LexisNexis (incl. Butterworths)
  ('lexis nexis', 'LexisNexis'),
  ('butterworth lexis nexis', 'LexisNexis'),
  ('lexis lexix', 'LexisNexis'),
  ('gurgaun lexis', 'LexisNexis'),
  -- Medical / academic
  ('lippincott', 'Lippincott Williams & Wilkins'),
  ('elsevier', 'Elsevier'),
  ('elsvier', 'Elsevier'),
  ('mosby', 'Elsevier'),
  ('who', 'World Health Organization'),
  ('h o w', 'World Health Organization'),
  ('oxford', 'Oxford University Press'),
  ('nirali', 'Nirali Prakashan'),
  ('nirali prakashan', 'Nirali Prakashan'),
  ('medical saurabh', 'Saurabh Medical Publishers'),
  ('health vision', 'Vision Health Sciences'),
  ('health science', 'Health Sciences Publishers'),
  ('emmess', 'EMMESS Medical Publishers'),
  ('tnai', 'Trained Nurses Association of India'),
  ('davis plus', 'F.A. Davis'),
  ('bartted jones', 'Jones & Bartlett Learning'),
  -- Law
  ('bharat law', 'Bharat Law House'),
  ('asia law', 'Asia Law House'),
  ('agency allahabad law', 'Allahabad Law Agency'),
  ('allhabad central', 'Allahabad Central Law Publications'),
  ('allhabad central law', 'Allahabad Central Law Publications'),
  ('taxmann', 'Taxmann Publications'),
  ('wadhwa', 'Wadhwa and Company'),
  -- Trade / general
  ('arya', 'Arya Publications'),
  ('arya d', 'Arya Publications'),
  ('aman', 'Aman Publications'),
  ('udh', 'UDH Publishers'),
  ('gyan', 'Gyan Publishing House'),
  ('gennext', 'GenNext Publications'),
  ('paritosh', 'Paritosh Publications'),
  ('alfa', 'Alfa Publications'),
  ('university', 'University Press'),
  ('umiversity', 'University Press'),
  ('abbeydale', 'Abbeydale Press'),
  ('rebo', 'Rebo Publishers'),
  ('front line', 'Frontline Publications'),
  ('frontline', 'Frontline Publications'),
  ('professionals', 'Professional Book Publishers'),
  ('vinod', 'Vinod Publications'),
  ('akansha', 'Akansha Publishing House'),
  ('education itl', 'ITL Education Solutions'),
  ('banarsidas', 'Banarasidas Bhanot'),
  ('r', 'N.R. Brothers'),
  ('nr', 'N.R. Brothers'),
  ('lal r', 'R. Lal Book Depot'),
  ('lall r', 'R. Lal Book Depot'),
  ('jain', 'Jain Publications')
  ) AS v(alias, canonical)
) AS s
WHERE s.alias_norm IS NOT NULL
ORDER BY s.alias_norm
ON CONFLICT (alias_norm) DO UPDATE SET
  canonical_name = EXCLUDED.canonical_name,
  canonical_norm = EXCLUDED.canonical_norm,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Resolve a raw publisher string to its canonical name (NULL if unknown).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_canonical_publisher(_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.canonical_name
  FROM public.library_publisher_aliases a
  WHERE a.alias_norm = public.library_normalize_publisher(_name)
     OR a.alias_norm = public.library_normalize_name(_name)
     OR a.canonical_norm = public.library_normalize_publisher(_name)
  ORDER BY (a.alias_norm = public.library_normalize_publisher(_name)) DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. upsert now resolves canonically before falling back to fuzzy normalisation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_upsert_publisher(_name text, _threshold float DEFAULT 0.72)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_norm text; v_name text; v_id uuid;
BEGIN
  v_name := coalesce(public.library_canonical_publisher(_name), trim(_name));
  v_norm := coalesce(public.library_normalize_publisher(v_name), public.library_normalize_name(v_name));
  IF v_norm IS NULL OR v_norm = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.library_publishers WHERE normalized_name = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_id FROM public.library_publishers
  WHERE similarity(normalized_name, v_norm) >= _threshold
  ORDER BY similarity(normalized_name, v_norm) DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.library_publishers (name, normalized_name, created_by)
  VALUES (v_name, v_norm, auth.uid())
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------------
-- 5. Bulk backfill: rewrite staged publishers, book publishers and entity rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_apply_publisher_canonicalization()
RETURNS TABLE(staging_updated int, books_updated int, publishers_merged int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staging int := 0;
  v_books int := 0;
  v_merged int := 0;
  v_tmp int;
  r record;
  v_target uuid;
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage publishers';
  END IF;

  -- Staged digitization rows.
  WITH resolved AS (
    SELECT id, public.library_canonical_publisher(publisher) AS canonical
    FROM public.library_digitization_records
    WHERE btrim(coalesce(publisher, '')) <> ''
  )
  UPDATE public.library_digitization_records d
  SET publisher = src.canonical, updated_at = now()
  FROM resolved src
  WHERE d.id = src.id
    AND src.canonical IS NOT NULL
    AND src.canonical IS DISTINCT FROM d.publisher;
  GET DIAGNOSTICS v_staging = ROW_COUNT;

  -- Book rows (text label; publisher_id is relinked below).
  WITH resolved AS (
    SELECT id, public.library_canonical_publisher(publisher) AS canonical
    FROM public.library_books
    WHERE btrim(coalesce(publisher, '')) <> ''
  )
  UPDATE public.library_books b
  SET publisher = src.canonical, updated_at = now()
  FROM resolved src
  WHERE b.id = src.id
    AND src.canonical IS NOT NULL
    AND src.canonical IS DISTINCT FROM b.publisher;
  GET DIAGNOSTICS v_books = ROW_COUNT;

  -- Publisher entities: relink each resolved row onto its canonical entity.
  FOR r IN
    SELECT id, name FROM public.library_publishers
    WHERE public.library_canonical_publisher(name) IS NOT NULL
  LOOP
    v_target := public.library_upsert_publisher(public.library_canonical_publisher(r.name));
    IF v_target IS NOT NULL AND v_target <> r.id THEN
      UPDATE public.library_books SET publisher_id = v_target WHERE publisher_id = r.id;
      DELETE FROM public.library_publishers WHERE id = r.id;
      v_merged := v_merged + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_staging, v_books, v_merged;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Review surface: distinct raw publishers with counts + resolution.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_publisher_usage(_search text DEFAULT NULL, _limit int DEFAULT 300)
RETURNS TABLE(
  publisher text,
  row_count int,
  canonical_name text,
  alias_norm text,
  is_resolved boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.publisher,
    count(*)::int,
    public.library_canonical_publisher(u.publisher),
    public.library_normalize_publisher(u.publisher),
    public.library_canonical_publisher(u.publisher) IS NOT NULL
  FROM (
    SELECT publisher FROM public.library_digitization_records WHERE btrim(coalesce(publisher, '')) <> ''
    UNION ALL
    SELECT publisher FROM public.library_books WHERE btrim(coalesce(publisher, '')) <> ''
  ) u
  WHERE public.can_operate_library()
    AND (_search IS NULL OR btrim(_search) = '' OR u.publisher ILIKE '%' || btrim(_search) || '%'
         OR public.library_canonical_publisher(u.publisher) ILIKE '%' || btrim(_search) || '%')
  GROUP BY u.publisher
  ORDER BY count(*) DESC, u.publisher
  LIMIT greatest(_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.library_list_publisher_aliases(_search text DEFAULT NULL, _limit int DEFAULT 300)
RETURNS TABLE(alias_norm text, canonical_name text, canonical_norm text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.alias_norm, a.canonical_name, a.canonical_norm
  FROM public.library_publisher_aliases a
  WHERE public.can_operate_library()
    AND (_search IS NULL OR btrim(_search) = '' OR a.alias_norm ILIKE '%' || btrim(_search) || '%'
         OR a.canonical_name ILIKE '%' || btrim(_search) || '%')
  ORDER BY a.canonical_name, a.alias_norm
  LIMIT greatest(_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.library_set_publisher_alias(_alias text, _canonical text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_norm text;
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage publishers';
  END IF;
  v_key := coalesce(public.library_normalize_publisher(_alias), public.library_normalize_name(_alias));
  v_norm := coalesce(public.library_normalize_publisher(_canonical), public.library_normalize_name(_canonical));
  IF v_key IS NULL OR v_key = '' THEN RAISE EXCEPTION 'Alias cannot be empty'; END IF;
  IF nullif(btrim(_canonical), '') IS NULL THEN RAISE EXCEPTION 'Canonical name cannot be empty'; END IF;

  INSERT INTO public.library_publisher_aliases (alias_norm, canonical_name, canonical_norm, created_by)
  VALUES (v_key, btrim(_canonical), v_norm, auth.uid())
  ON CONFLICT (alias_norm) DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name,
    canonical_norm = EXCLUDED.canonical_norm,
    updated_at = now();
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.library_delete_publisher_alias(_alias_norm text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted int := 0;
BEGIN
  IF NOT public.can_operate_library() THEN
    RAISE EXCEPTION 'You do not have permission to manage publishers';
  END IF;
  DELETE FROM public.library_publisher_aliases WHERE alias_norm = _alias_norm;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants / lockdown.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_publisher_aliases TO authenticated;
GRANT ALL ON public.library_publisher_aliases TO service_role;

DO $$
DECLARE fn text;
  fns text[] := ARRAY[
    'public.library_canonical_publisher(text)',
    'public.library_apply_publisher_canonicalization()',
    'public.library_publisher_usage(text, int)',
    'public.library_list_publisher_aliases(text, int)',
    'public.library_set_publisher_alias(text, text)',
    'public.library_delete_publisher_alias(text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
