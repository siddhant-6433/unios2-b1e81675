-- Academic-partner leads: optional "share with NIMT" gate.
--
-- Partners can add leads that stay private to their portal. By default such a
-- lead is NOT shared with the NIMT admissions team: no counsellor assignment,
-- no AI auto-call, no automated WhatsApp/messages. Only when the partner opts
-- in ("share with NIMT") do the normal automations run.
--
-- Mechanism: reuse the existing `skip_ai_call` universal opt-out (already
-- honoured by fn_auto_ai_call_new_lead + fn_automation_on_lead_created, the
-- latter being what invokes the automation-engine that assigns counsellors and
-- sends messages). We also gate the welcome-WhatsApp trigger on it. A private
-- partner lead is inserted with skip_ai_call = true.
--
-- `shared_with_nimt` records the business intent explicitly. Default TRUE so
-- every existing/normal lead (website, ads, walk-in, consultant, …) is
-- unaffected — only partner leads with the box unchecked become private.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS shared_with_nimt boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.leads.shared_with_nimt IS
  'Whether the NIMT admissions team may work this lead (counsellor calls + automations). Academic-partner leads default to false unless the partner opts in.';

-- Gate the welcome-WhatsApp on the same universal opt-out the other
-- lead-created triggers already respect.
CREATE OR REPLACE FUNCTION public.fn_auto_welcome_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_course_name text; v_source_label text; v_url text; v_secret text;
BEGIN
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;
  SELECT name INTO v_course_name FROM public.courses WHERE id = NEW.course_id;
  v_course_name := COALESCE(v_course_name, 'our programmes');
  v_source_label := INITCAP(REPLACE(NEW.source::text, '_', ' '));
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'  LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;
  IF NEW.phone IS NOT NULL AND length(NEW.phone) >= 10 THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
      body    := jsonb_build_object('template_key','lead_welcome','phone',NEW.phone,
        'params', jsonb_build_array(NEW.name, v_course_name, v_source_label),
        'lead_id', NEW.id));
  END IF;
  RETURN NEW;
END $function$;

-- Extend the association RPC with the share flag. Private partner leads get
-- skip_ai_call = true so every lead_created automation is short-circuited.
CREATE OR REPLACE FUNCTION public.submit_lead_association_request(
  _requester_type text,
  _name text,
  _phone text,
  _email text DEFAULT NULL::text,
  _course_id uuid DEFAULT NULL::uuid,
  _campus_id uuid DEFAULT NULL::uuid,
  _notes text DEFAULT NULL::text,
  _consultant_id uuid DEFAULT NULL::uuid,
  _academic_partner_id uuid DEFAULT NULL::uuid,
  _share_with_nimt boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_existing_lead_id uuid;
  v_request_id uuid;
  v_new_lead_id uuid;
  -- Only academic-partner leads honour the private/share gate; every other
  -- requester keeps the existing NIMT-visible behaviour.
  v_shared boolean := CASE WHEN _requester_type = 'academic_partner'
                           THEN COALESCE(_share_with_nimt, false) ELSE true END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_phone := public.normalize_lead_phone(_phone);
  IF v_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  IF _requester_type = 'consultant' THEN
    IF _consultant_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.consultants c
      WHERE c.id = _consultant_id AND c.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Invalid consultant';
    END IF;
  ELSIF _requester_type = 'academic_partner' THEN
    IF _academic_partner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.academic_partners ap
      WHERE ap.id = _academic_partner_id AND ap.user_id = v_uid AND ap.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid academic partner';
    END IF;
    IF _course_id IS NULL OR NOT public.is_academic_partner_scope(v_uid, _course_id, NULL) THEN
      RAISE EXCEPTION 'Course is outside academic partner scope';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid requester type';
  END IF;

  SELECT id INTO v_existing_lead_id
  FROM public.leads
  WHERE public.normalize_lead_phone(phone) = v_phone
  LIMIT 1;

  IF v_existing_lead_id IS NULL THEN
    INSERT INTO public.leads (
      name, phone, email, source, course_id, campus_id,
      consultant_id, academic_partner_id, notes, stage,
      shared_with_nimt, skip_ai_call
    )
    VALUES (
      _name, v_phone, NULLIF(_email, ''),
      CASE WHEN _requester_type = 'consultant' THEN 'consultant'::lead_source ELSE 'academic_partner'::lead_source END,
      _course_id, _campus_id,
      CASE WHEN _requester_type = 'consultant' THEN _consultant_id ELSE NULL END,
      CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END,
      NULLIF(_notes, ''),
      'new_lead'::lead_stage,
      v_shared,
      -- Private partner lead => opt out of every lead_created automation.
      (_requester_type = 'academic_partner' AND NOT v_shared)
    )
    RETURNING id INTO v_new_lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (
      v_new_lead_id,
      'system',
      CASE WHEN _requester_type = 'consultant'
        THEN 'Lead added via consultant portal'
        WHEN _requester_type = 'academic_partner' AND NOT v_shared
        THEN 'Lead added via academic partner portal (private — not shared with NIMT)'
        ELSE 'Lead added via academic partner portal'
      END
    );

    RETURN jsonb_build_object('status', 'created', 'lead_id', v_new_lead_id);
  END IF;

  SELECT id INTO v_request_id
  FROM public.lead_association_requests
  WHERE requester_type = _requester_type
    AND status = 'pending'
    AND lead_id = v_existing_lead_id
    AND (
      (_requester_type = 'consultant' AND consultant_id = _consultant_id)
      OR
      (_requester_type = 'academic_partner' AND academic_partner_id = _academic_partner_id)
    )
  LIMIT 1;

  IF v_request_id IS NULL THEN
    INSERT INTO public.lead_association_requests (
      requester_type, consultant_id, academic_partner_id, lead_id,
      requested_phone, proposed_name, proposed_email, proposed_course_id,
      proposed_campus_id, proposed_notes, requested_by
    )
    VALUES (
      _requester_type,
      CASE WHEN _requester_type = 'consultant' THEN _consultant_id ELSE NULL END,
      CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END,
      v_existing_lead_id,
      v_phone,
      _name,
      NULLIF(_email, ''),
      _course_id,
      _campus_id,
      NULLIF(_notes, ''),
      v_uid
    )
    RETURNING id INTO v_request_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'pending',
    'request_id', v_request_id,
    'lead_id', v_existing_lead_id
  );
END;
$function$;

-- Adding the parameter created a new overload; drop the old 9-arg version so
-- there is a single canonical function. 9-arg callers (consultant portal) bind
-- to the new one via the _share_with_nimt default.
DROP FUNCTION IF EXISTS public.submit_lead_association_request(text, text, text, text, uuid, uuid, text, uuid, uuid);

GRANT EXECUTE ON FUNCTION public.submit_lead_association_request(text, text, text, text, uuid, uuid, text, uuid, uuid, boolean) TO authenticated;
