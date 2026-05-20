-- Extend upsert_application_lead to accept Meta CAPI attribution context.
-- Adds _fbc, _fbp, _portal_brand at the tail so existing call sites with
-- fewer args keep working. First-touch semantics via COALESCE on UPDATE —
-- mirrors the GA attribution columns added in 20260603130000.
--
-- _portal_brand is the routing key the meta-capi-events relay uses to
-- pick the right pixel + access token (nimt / beacon / mirai). The
-- browser resolves it via detectPortal() before calling the RPC.
--
-- Drop the previous 18-param signature first; CREATE OR REPLACE only
-- matches on identical signatures and would otherwise leave the old
-- overload behind, making the trailing GRANT EXECUTE ambiguous.

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
      fbc            = COALESCE(fbc, _fbc),
      fbp            = COALESCE(fbp, _fbp),
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
