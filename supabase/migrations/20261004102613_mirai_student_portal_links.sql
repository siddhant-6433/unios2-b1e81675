-- Generated with db:migration:new. No permissions or trigger timing changes.
-- Activate only with the frontend and edge-function gates after launch checks.
INSERT INTO public._app_config (key, value) VALUES ('mirai_rollout_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.student_website_base(_student_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_base text; v_student record; v_lead record; v_portal text; v_mirai_course boolean;
BEGIN
  SELECT value INTO v_base FROM public._app_config WHERE key = 'student_portal_base';
  v_base := COALESCE(v_base, 'https://uni.nimt.ac.in/student');
  IF NOT EXISTS (SELECT 1 FROM public._app_config WHERE key = 'mirai_rollout_enabled' AND value = 'true') THEN
    RETURN v_base;
  END IF;
  SELECT lead_id, course_id INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN RETURN v_base; END IF;
  -- Use the same saved application flags before lead/course fallbacks as the
  -- application portal. Avantika's shared campus is deliberately not a signal.
  SELECT regexp_replace(lower(btrim(flag.value)), '^portal:', '') INTO v_portal
  FROM (SELECT flags, created_at FROM public.applications WHERE lead_id = v_student.lead_id
        ORDER BY created_at DESC LIMIT 5) app
  CROSS JOIN LATERAL unnest(app.flags) WITH ORDINALITY AS flag(value, position)
  WHERE regexp_replace(lower(btrim(flag.value)), '^portal:', '') IN ('nimt', 'beacon', 'mirai')
  ORDER BY app.created_at DESC, flag.position LIMIT 1;
  IF v_portal IS NOT NULL THEN
    RETURN CASE WHEN v_portal = 'mirai' THEN 'https://uni.miraischool.in/student' ELSE v_base END;
  END IF;
  SELECT portal_brand, source, origin_domain, landing_page, course_id INTO v_lead
  FROM public.leads WHERE id = v_student.lead_id;
  IF regexp_replace(lower(btrim(v_lead.portal_brand)), '^portal:', '') IN ('mirai', 'beacon') THEN
    RETURN CASE WHEN regexp_replace(lower(btrim(v_lead.portal_brand)), '^portal:', '') = 'mirai' THEN 'https://uni.miraischool.in/student' ELSE v_base END;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.courses c JOIN public.departments d ON d.id = c.department_id
    WHERE d.institution_id = 'd8c95a30-ecc6-4b41-8bed-987c960dc44a'::uuid
      AND (c.id = COALESCE(v_student.course_id, v_lead.course_id)
        OR EXISTS (
          SELECT 1
          FROM (SELECT course_selections FROM public.applications WHERE lead_id = v_student.lead_id
                ORDER BY created_at DESC LIMIT 5) app
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(app.course_selections) = 'array' THEN app.course_selections ELSE '[]'::jsonb END
          ) selection
          -- Compare text rather than casting untrusted JSON to uuid.
          WHERE lower(selection->>'course_id') = c.id::text
        ))
  ) INTO v_mirai_course;
  IF v_mirai_course OR lower(v_lead.source) = 'mirai_website'
     OR COALESCE(v_lead.origin_domain, '') ~* 'mirai|mes-|miraischool\.in'
     OR COALESCE(v_lead.landing_page, '') ~* 'mirai|mes-|miraischool\.in'
     OR EXISTS (SELECT 1
                FROM (SELECT course_selections FROM public.applications WHERE lead_id = v_student.lead_id
                      ORDER BY created_at DESC LIMIT 5) app
                WHERE course_selections::text ~* 'mirai|mes-|miraischool\.in') THEN
    RETURN 'https://uni.miraischool.in/student';
  END IF;
  RETURN v_base;
END;
$$;
REVOKE ALL ON FUNCTION public.student_website_base(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_website_base(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_student_login_link(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student  public.students%ROWTYPE;
  v_phone    text;
  v_base     text;
  v_token    text;
  v_id       uuid;
BEGIN
  IF NOT (public.can_collect_fee(auth.uid())
          OR public.has_role(auth.uid(), 'super_admin')
          OR public.can_academic_partner_view_fee_student(auth.uid(), _student_id)) THEN
    RAISE EXCEPTION 'Not authorised to issue a student login link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_student FROM public.students WHERE id = _student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  v_phone := NULLIF(COALESCE(v_student.phone, v_student.whatsapp_no), '');

  -- One live link at a time: a freshly handed-out link must be the one that
  -- works, and an old unclaimed token left valid is a standing back door.
  UPDATE public.student_magic_tokens
     SET expires_at = now()
   WHERE student_id = _student_id
     AND claimed_at IS NULL
     AND expires_at > now();

  INSERT INTO public.student_magic_tokens (student_id, lead_id, phone, email, expires_at, auto_send)
  VALUES (_student_id, v_student.lead_id, v_phone, NULLIF(v_student.email,''),
          now() + interval '7 days', false)
  RETURNING id, token INTO v_id, v_token;

  v_base := public.student_website_base(_student_id);

  RETURN jsonb_build_object(
    'token_id', v_id,
    'token', v_token,
    'url',   COALESCE(v_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_token,
    'phone', v_phone,
    'expires_at', (now() + interval '7 days')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_student_claim_link(_token_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tok public.student_magic_tokens%ROWTYPE;
  v_supa_url text; v_cron_secret text; v_portal_base text; v_claim_url text;
  v_student_name text; v_admission_no text;
BEGIN
  SELECT * INTO v_tok FROM public.student_magic_tokens WHERE id = _token_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent', false, 'reason', 'token not found'); END IF;
  IF v_tok.phone IS NULL OR v_tok.phone = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no phone on the token'); END IF;

  SELECT value INTO v_supa_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  IF v_supa_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING 'send_student_claim_link: missing supabase_url or CRON_SECRET';
    RETURN jsonb_build_object('sent', false, 'reason', 'messaging not configured');
  END IF;

  v_portal_base := public.student_website_base(v_tok.student_id);
  v_claim_url := COALESCE(v_portal_base, 'https://uni.nimt.ac.in/student') || '?token=' || v_tok.token;

  SELECT name, admission_no INTO v_student_name, v_admission_no
    FROM public.students WHERE id = v_tok.student_id;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/whatsapp-send',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_cron_secret),
    body    := jsonb_build_object(
      'template_key', 'student_portal_invite', 'phone', v_tok.phone, 'lead_id', v_tok.lead_id, 'student_id', v_tok.student_id,
      'params', jsonb_build_array(COALESCE(v_student_name, 'Student'), COALESCE(v_admission_no, '')),
      'button_urls', jsonb_build_array(v_claim_url))
  );

  IF v_tok.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_tok.lead_id, 'system', 'Student-portal claim link sent via WhatsApp: ' || v_claim_url);
  END IF;

  RETURN jsonb_build_object('sent', true, 'phone', v_tok.phone, 'url', v_claim_url);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'send_student_claim_link failed for token %: %', _token_id, SQLERRM;
  RETURN jsonb_build_object('sent', false, 'reason', SQLERRM);
END;
$function$;
