-- School offer-letter hardening
--
-- Beacon/Mirai applications use the same offer-letter tables as college
-- applications. This migration keeps the linked CRM lead aligned to the
-- application's selected class/course and keeps offer_letters.net_fee aligned
-- with approved offer_waivers.

-- 1) Backfill linked leads from application course selections where the lead
--    has no course/campus yet. Current application JSON stores course_id and
--    campus_id; legacy rows may only have names, so the second pass resolves
--    by course name + optional campus name.

UPDATE public.leads l
SET
  course_id = (a.course_selections->0->>'course_id')::uuid,
  campus_id = COALESCE(NULLIF(a.course_selections->0->>'campus_id', '')::uuid, l.campus_id),
  updated_at = now()
FROM public.applications a
WHERE a.lead_id = l.id
  AND l.course_id IS NULL
  AND a.program_category = 'school'
  AND a.course_selections IS NOT NULL
  AND jsonb_typeof(a.course_selections) = 'array'
  AND jsonb_array_length(a.course_selections) > 0
  AND (a.course_selections->0->>'course_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (
    NULLIF(a.course_selections->0->>'campus_id', '') IS NULL
    OR (a.course_selections->0->>'campus_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

UPDATE public.leads l
SET
  course_id = c.id,
  campus_id = COALESCE(i.campus_id, l.campus_id),
  updated_at = now()
FROM public.applications a
JOIN public.courses c
  ON lower(c.name) = lower(a.course_selections->0->>'course_name')
JOIN public.departments d
  ON d.id = c.department_id
JOIN public.institutions i
  ON i.id = d.institution_id
LEFT JOIN public.campuses ca
  ON ca.id = i.campus_id
WHERE a.lead_id = l.id
  AND l.course_id IS NULL
  AND a.program_category = 'school'
  AND a.course_selections IS NOT NULL
  AND jsonb_typeof(a.course_selections) = 'array'
  AND jsonb_array_length(a.course_selections) > 0
  AND NULLIF(a.course_selections->0->>'course_name', '') IS NOT NULL
  AND (
    NULLIF(a.course_selections->0->>'campus_name', '') IS NULL
    OR lower(ca.name) = lower(a.course_selections->0->>'campus_name')
  );

-- 2) For future application starts/resumes, the current application selection
--    should win over stale lead interest. This matters for a family applying
--    to Beacon/Mirai with a phone number that already has an older college or
--    school lead.

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
      application_id = COALESCE(_application_id, application_id),
      course_id      = COALESCE(_course_id, course_id),
      campus_id      = COALESCE(_campus_id, campus_id),
      email          = COALESCE(_email, email),
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
      fbp            = COALESCE(_fbp, fbp),
      portal_brand   = COALESCE(_portal_brand, portal_brand),
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

-- 3) Keep the offer's stored net_fee consistent with approved waivers. The
--    PDF and fee-status RPCs already read offer_waivers directly; net_fee is
--    still used by inboxes, WhatsApp/email templates, and offer cards.

CREATE OR REPLACE FUNCTION public.recalculate_offer_letter_net_fee(_offer_letter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_fee numeric := 0;
  v_scholarship numeric := 0;
  v_approved_waivers numeric := 0;
  v_net_fee numeric := 0;
  v_lead_id uuid;
BEGIN
  SELECT total_fee, COALESCE(scholarship_amount, 0), lead_id
    INTO v_total_fee, v_scholarship, v_lead_id
  FROM public.offer_letters
  WHERE id = _offer_letter_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_approved_waivers
  FROM public.offer_waivers
  WHERE offer_letter_id = _offer_letter_id
    AND status = 'approved';

  v_net_fee := GREATEST(0, COALESCE(v_total_fee, 0) - v_scholarship - v_approved_waivers);

  UPDATE public.offer_letters
  SET net_fee = v_net_fee
  WHERE id = _offer_letter_id
    AND net_fee IS DISTINCT FROM v_net_fee;

  UPDATE public.leads
  SET offer_amount = v_net_fee
  WHERE id = v_lead_id
    AND EXISTS (
      SELECT 1
      FROM public.offer_letters ol
      WHERE ol.id = _offer_letter_id
        AND ol.approval_status = 'approved'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_recalculate_offer_letter_net_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_letter_id uuid;
BEGIN
  v_offer_letter_id := COALESCE(NEW.offer_letter_id, OLD.offer_letter_id);
  PERFORM public.recalculate_offer_letter_net_fee(v_offer_letter_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS offer_waivers_recalculate_offer_net_fee ON public.offer_waivers;
CREATE TRIGGER offer_waivers_recalculate_offer_net_fee
AFTER INSERT OR UPDATE OF amount, status OR DELETE ON public.offer_waivers
FOR EACH ROW EXECUTE FUNCTION public.tg_recalculate_offer_letter_net_fee();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT offer_letter_id FROM public.offer_waivers LOOP
    PERFORM public.recalculate_offer_letter_net_fee(r.offer_letter_id);
  END LOOP;
END $$;
