-- Improved duplicate detection: weighted scoring across phone, email, name
-- Phone match = highest confidence (exact or last-10-digit match)
-- Email match = high confidence (exact or domain-stripped match)
-- Name similarity = lower confidence, used as supporting signal

-- Ensure pg_trgm extension is available (for similarity())
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.find_lead_duplicates(
  p_lead_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  created_at timestamptz,
  match_score float,
  match_reasons text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_digits text;
  v_email_lower text;
  v_email_local text;
  v_email_domain text;
BEGIN
  -- Normalize inputs
  v_phone_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  -- Keep last 10 digits for matching (strip country code)
  IF length(v_phone_digits) > 10 THEN
    v_phone_digits := right(v_phone_digits, 10);
  END IF;

  v_email_lower := lower(trim(COALESCE(p_email, '')));
  IF v_email_lower LIKE '%@%' THEN
    v_email_local := split_part(v_email_lower, '@', 1);
    v_email_domain := split_part(v_email_lower, '@', 2);
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.stage::text,
      l.source::text,
      l.created_at,
      -- Phone: exact last-10-digit match (highest signal)
      CASE
        WHEN v_phone_digits != '' AND length(v_phone_digits) >= 10
             AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_phone_digits
        THEN 0.50
        ELSE 0.0
      END AS phone_score,
      -- Email: exact match or local-part match
      CASE
        WHEN v_email_lower != '' AND lower(trim(COALESCE(l.email, ''))) = v_email_lower
        THEN 0.40
        WHEN v_email_local IS NOT NULL AND v_email_local != ''
             AND length(v_email_local) >= 3
             AND l.email IS NOT NULL
             AND split_part(lower(trim(l.email)), '@', 1) = v_email_local
        THEN 0.30
        ELSE 0.0
      END AS email_score,
      -- Name: trigram similarity (supporting signal, not primary)
      CASE
        WHEN p_name IS NOT NULL AND length(p_name) >= 3 AND l.name IS NOT NULL
        THEN LEAST(similarity(l.name, p_name)::float * 0.25, 0.25)
        ELSE 0.0
      END AS name_score,
      -- Guardian phone match (bonus)
      CASE
        WHEN v_phone_digits != '' AND length(v_phone_digits) >= 10
             AND l.guardian_phone IS NOT NULL
             AND right(regexp_replace(l.guardian_phone, '\D', '', 'g'), 10) = v_phone_digits
        THEN 0.15
        ELSE 0.0
      END AS guardian_phone_score
    FROM leads l
    WHERE l.id != COALESCE(p_lead_id, '00000000-0000-0000-0000-000000000000'::uuid)
      -- Pre-filter: at least one potential match to avoid full table scan
      AND (
        -- Phone match candidate
        (v_phone_digits != '' AND length(v_phone_digits) >= 10 AND (
          right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_phone_digits
          OR (l.guardian_phone IS NOT NULL AND right(regexp_replace(l.guardian_phone, '\D', '', 'g'), 10) = v_phone_digits)
        ))
        -- Email match candidate
        OR (v_email_lower != '' AND l.email IS NOT NULL AND lower(trim(l.email)) = v_email_lower)
        OR (v_email_local IS NOT NULL AND v_email_local != '' AND length(v_email_local) >= 3
            AND l.email IS NOT NULL AND split_part(lower(trim(l.email)), '@', 1) = v_email_local)
        -- Name similarity candidate (only if no phone/email provided)
        OR (v_phone_digits = '' AND v_email_lower = '' AND p_name IS NOT NULL AND length(p_name) >= 3
            AND similarity(l.name, p_name) > 0.45)
      )
  )
  SELECT
    c.id, c.name, c.phone, c.email, c.stage, c.source, c.created_at,
    (c.phone_score + c.email_score + c.name_score + c.guardian_phone_score) AS match_score,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.phone_score > 0 THEN 'exact_phone' END,
      CASE WHEN c.email_score >= 0.40 THEN 'exact_email' END,
      CASE WHEN c.email_score >= 0.30 AND c.email_score < 0.40 THEN 'similar_email' END,
      CASE WHEN c.name_score > 0.15 THEN 'similar_name' END,
      CASE WHEN c.name_score > 0 AND c.name_score <= 0.15 THEN 'weak_name' END,
      CASE WHEN c.guardian_phone_score > 0 THEN 'guardian_phone' END
    ], NULL) AS match_reasons
  FROM candidates c
  WHERE (c.phone_score + c.email_score + c.name_score + c.guardian_phone_score) > 0.15
  ORDER BY (c.phone_score + c.email_score + c.name_score + c.guardian_phone_score) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_lead_duplicates TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_lead_duplicates TO service_role;
