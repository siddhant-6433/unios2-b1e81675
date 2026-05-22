-- Meta brand capture + backfill
--
-- Two pieces of work, intentionally bundled because they're useless apart:
--
--   1. Extend upsert_application_lead to accept and persist the Meta CAPI
--      match-quality fields (_fbc, _fbp, _portal_brand). The apply portal
--      already captures these in captureAttribution() (src/lib/analytics.ts)
--      and spreads them into the RPC call, but the prior 18-param signature
--      silently dropped them. Result: 0/6,262 apply-portal leads in the
--      last 30 days had fbc/fbp/portal_brand persisted, even though the
--      browser had them in localStorage all along. That's the only reason
--      the CAPI relay sees ~0% match-quality lift over hashed-phone-only.
--
--   2. Backfill portal_brand on existing leads by deriving the brand from
--      whatever signal is present: origin_domain (from the GA attribution
--      capture), meta_page_id (Meta Lead Ads brand routing — Beacon's FB
--      page is "NIMT School", Mirai is "Mirai Experiential School", the
--      umbrella "NIMT Educational Institutions" page covers the college),
--      campus_id (Arthala → beacon, Mirai → mirai). Anything else
--      defaults to 'nimt' because that's also what meta-capi-events
--      falls back to at runtime.
--
-- Idempotent: signature update uses DROP IF EXISTS + CREATE; backfill is
-- guarded by `WHERE portal_brand IS NULL` so re-running on an already-
-- populated table is a no-op.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Drop the prior 18-param signature and recreate with fbc/fbp/brand.
-- ─────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.upsert_application_lead(
  text, text, text, uuid, uuid, text, text,
  text, text, text, text, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.upsert_application_lead(
  _name text,
  _phone text,
  _email text DEFAULT NULL,
  _course_id uuid DEFAULT NULL,
  _campus_id uuid DEFAULT NULL,
  _application_id text DEFAULT NULL,
  _source text DEFAULT 'website',
  _ga_client_id text DEFAULT NULL,
  _ga_session_id text DEFAULT NULL,
  _gclid text DEFAULT NULL,
  _utm_source text DEFAULT NULL,
  _utm_medium text DEFAULT NULL,
  _utm_campaign text DEFAULT NULL,
  _utm_term text DEFAULT NULL,
  _utm_content text DEFAULT NULL,
  _landing_page text DEFAULT NULL,
  _referrer text DEFAULT NULL,
  _origin_domain text DEFAULT NULL,
  _fbc text DEFAULT NULL,
  _fbp text DEFAULT NULL,
  _portal_brand text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  IF _phone IS NOT NULL AND length(regexp_replace(_phone, '\D', '', 'g')) = 10 THEN
    _phone := '+91' || regexp_replace(_phone, '\D', '', 'g');
  END IF;

  SELECT id INTO v_lead_id FROM public.leads WHERE phone = _phone LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET stage = CASE
          WHEN stage IN ('new_lead', 'ai_called', 'counsellor_call') THEN 'application_in_progress'::lead_stage
          ELSE stage
        END,
      application_id = COALESCE(application_id, _application_id),
      course_id      = COALESCE(course_id, _course_id),
      campus_id      = COALESCE(campus_id, _campus_id),
      email          = COALESCE(email, _email),
      person_role    = 'applicant',
      ga_client_id   = COALESCE(ga_client_id, _ga_client_id),
      ga_session_id  = COALESCE(ga_session_id, _ga_session_id),
      gclid          = COALESCE(gclid, _gclid),
      utm_source     = COALESCE(utm_source, _utm_source),
      utm_medium     = COALESCE(utm_medium, _utm_medium),
      utm_campaign   = COALESCE(utm_campaign, _utm_campaign),
      utm_term       = COALESCE(utm_term, _utm_term),
      utm_content    = COALESCE(utm_content, _utm_content),
      landing_page   = COALESCE(landing_page, _landing_page),
      referrer       = COALESCE(referrer, _referrer),
      origin_domain  = COALESCE(origin_domain, _origin_domain),
      -- First-touch semantics: only fill on NULL, never overwrite the original
      -- click attribution. fbp gets refreshed every visit by the Pixel itself
      -- so last-write is fine, but fbc preserves the click that brought the
      -- lead in.
      fbc            = COALESCE(fbc, _fbc),
      fbp            = COALESCE(_fbp, fbp),
      portal_brand   = COALESCE(portal_brand, _portal_brand),
      updated_at     = now()
    WHERE id = v_lead_id;
  ELSE
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, stage, person_role, application_id,
      ga_client_id, ga_session_id, gclid,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      landing_page, referrer, origin_domain,
      fbc, fbp, portal_brand
    ) VALUES (
      COALESCE(NULLIF(_name, ''), 'Applicant'),
      _phone,
      _email,
      _course_id,
      _campus_id,
      _source::lead_source,
      'application_in_progress'::lead_stage,
      'applicant',
      _application_id,
      _ga_client_id, _ga_session_id, _gclid,
      _utm_source, _utm_medium, _utm_campaign, _utm_term, _utm_content,
      _landing_page, _referrer, _origin_domain,
      _fbc, _fbp, _portal_brand
    )
    RETURNING id INTO v_lead_id;
  END IF;

  RETURN v_lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_application_lead(
  text, text, text, uuid, uuid, text, text,
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text
) TO authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Backfill portal_brand on existing leads.
--    Order matters — most specific signal first; later passes only fire
--    when portal_brand is still NULL.
-- ─────────────────────────────────────────────────────────────────────

-- 2a) origin_domain: the apply portal + GA-aware ingest paths set this.
--     Map matches lead-ingest's brandFromOrigin (functions/lead-ingest/index.ts).
UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL AND lower(origin_domain) LIKE '%miraischool.in';

UPDATE public.leads SET portal_brand = 'beacon'
 WHERE portal_brand IS NULL
   AND (lower(origin_domain) LIKE '%nimtbeaconschool.com'
        OR lower(origin_domain) LIKE '%school.nimt.ac.in');

UPDATE public.leads SET portal_brand = 'nimt'
 WHERE portal_brand IS NULL AND lower(origin_domain) LIKE '%nimt.ac.in';

-- 2b) Meta Lead Ads page_id → brand. Three pages are wired up to UniOs
--     (see meta_ads_per_page_bucket migration). The "NIMT School" FB page
--     drives Beacon (CBSE) admissions; Mirai is its own page; the umbrella
--     "NIMT Educational Institutions" page is the parent NIMT brand.
UPDATE public.leads SET portal_brand = 'beacon'
 WHERE portal_brand IS NULL
   AND source = 'meta_ads'
   AND meta_page_id = '111711207848445';

UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL
   AND source = 'meta_ads'
   AND meta_page_id = '1016687728205021';

UPDATE public.leads SET portal_brand = 'nimt'
 WHERE portal_brand IS NULL
   AND source = 'meta_ads'
   AND meta_page_id = '443493925579';

-- 2c) campus_id fallback. meta_ads_per_page_bucket backfilled campus_id
--     for older Meta leads — pick up brand from there.
UPDATE public.leads SET portal_brand = 'beacon'
 WHERE portal_brand IS NULL
   AND campus_id = 'c0000001-0000-0000-0000-000000000002'::uuid;  -- Arthala (Beacon)

UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL
   AND campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid;  -- Mirai

-- 2d) Mirai-source intake (parseMirai in lead-ingest).
UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL AND source = 'mirai_website';

-- 2e) Course code fallback — Mirai courses are MES-* (see parseMirai).
UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL
   AND course_id IN (SELECT id FROM public.courses WHERE code LIKE 'MES-%');

-- 2f) Landing page path segment — apply portal links like /apply/beacon.
UPDATE public.leads SET portal_brand = 'beacon'
 WHERE portal_brand IS NULL AND landing_page ~* '/(beacon)(/|$|\?)';

UPDATE public.leads SET portal_brand = 'mirai'
 WHERE portal_brand IS NULL AND landing_page ~* '/(mirai)(/|$|\?)';

UPDATE public.leads SET portal_brand = 'nimt'
 WHERE portal_brand IS NULL AND landing_page ~* '/(nimt)(/|$|\?)';

-- 2g) Everything else defaults to 'nimt' — that's also what
--     meta-capi-events/index.ts (DEFAULT_BRAND) uses at runtime, so this
--     just makes the implicit explicit. NIMT is the umbrella brand.
UPDATE public.leads SET portal_brand = 'nimt' WHERE portal_brand IS NULL;
