-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905065800 name=cold_call_disposition_and_promotion applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.clamp_to_business_hours(_ts timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN v.mins >= 540 AND v.mins < 1200 THEN _ts
    ELSE (date_trunc('day', v.ist)
          + CASE WHEN v.mins >= 1200 THEN interval '1 day' ELSE interval '0' END
          + interval '9 hours') AT TIME ZONE 'Asia/Kolkata'
  END
  FROM (
    SELECT ist, EXTRACT(hour FROM ist) * 60 + EXTRACT(minute FROM ist) AS mins
    FROM (SELECT _ts AT TIME ZONE 'Asia/Kolkata' AS ist) x
  ) v;
$function$;

GRANT EXECUTE ON FUNCTION public.clamp_to_business_hours(timestamptz) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.promote_marketing_contact(uuid, lead_source, text);

CREATE FUNCTION public.promote_marketing_contact(
  _contact_id uuid,
  _source lead_source DEFAULT 'other'::lead_source,
  _reason text DEFAULT 'engaged'::text,
  _counsellor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c            public.marketing_contacts%ROWTYPE;
  v_lead_id    uuid;
  v_normalized text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
    OR public.has_role(auth.uid(), 'counsellor'::app_role)
  ) THEN
    RAISE EXCEPTION 'not authorized to promote marketing contacts';
  END IF;

  SELECT * INTO c FROM public.marketing_contacts WHERE id = _contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF c.promoted_lead_id IS NOT NULL THEN
    RETURN c.promoted_lead_id;
  END IF;

  v_normalized := public.normalize_lead_phone(c.phone);

  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE is_mirror = false
     AND public.normalize_lead_phone(phone) = v_normalized
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (id, name, phone, email, city, area, state,
                              source, stage, skip_ai_call)
    VALUES (c.id,
            COALESCE(NULLIF(btrim(c.name), ''), c.phone),
            c.phone, c.email, c.city, c.area, c.state,
            _source, 'new_lead', true)
    RETURNING id INTO v_lead_id;

    IF _counsellor_id IS NOT NULL THEN
      UPDATE public.leads
         SET counsellor_id = _counsellor_id, assigned_at = now()
       WHERE id = v_lead_id;
    ELSE
      PERFORM public.fn_intake_round_robin_assign(v_lead_id);
    END IF;
  END IF;

  UPDATE public.marketing_contacts
     SET promoted_lead_id = v_lead_id,
         promoted_at      = now(),
         promotion_reason = _reason,
         updated_at       = now()
   WHERE id = _contact_id;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (v_lead_id, 'system',
          'Promoted from marketing contact (' || _reason || ')');

  INSERT INTO public.lead_engagement_events (lead_id, phone, event_type, metadata)
  VALUES (v_lead_id, c.phone, 'contact_promoted',
          jsonb_build_object('contact_id', c.id, 'reason', _reason));

  RETURN v_lead_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_marketing_contact(uuid, lead_source, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_marketing_contact(uuid, lead_source, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cold_call_disposition(
  p_member_id     uuid,
  p_call_uuid     text,
  p_disposition   text,
  p_duration      integer DEFAULT 0,
  p_notes         text    DEFAULT NULL,
  p_qualification jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  m              public.lead_list_members%ROWTYPE;
  v_uid          uuid := auth.uid();
  v_profile_id   uuid;
  v_contact      public.marketing_contacts%ROWTYPE;
  v_lead_id      uuid    := NULL;
  v_call_log_id  uuid;
  v_attempt      integer;
  v_work_status  text;
  v_next_attempt timestamptz := NULL;
  v_promoted     boolean := false;
  c_max_attempts constant integer := 2;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  SELECT * INTO m FROM public.lead_list_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Call list member not found';
  END IF;
  IF m.contact_id IS NULL THEN
    RAISE EXCEPTION 'Member is lead-backed — use the lead disposition path';
  END IF;
  IF NOT (m.assigned_to IS NOT DISTINCT FROM v_profile_id OR public.can_manage_lead_lists()) THEN
    RAISE EXCEPTION 'This call list member is not assigned to you';
  END IF;

  SELECT * INTO v_contact FROM public.marketing_contacts WHERE id = m.contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  v_call_log_id := public.record_cloud_call_log(
    p_call_uuid, NULL, v_uid, p_disposition, COALESCE(p_duration, 0),
    COALESCE(NULLIF(btrim(p_notes), ''), 'Cold call: ' || replace(p_disposition, '_', ' ')),
    'manual', NULL, 'cold_call', m.contact_id);

  UPDATE public.marketing_contacts
     SET last_contacted_at = now(), updated_at = now()
   WHERE id = m.contact_id;

  v_attempt := COALESCE(m.attempt_count, 0) + 1;

  IF p_disposition IN ('interested', 'call_back') THEN
    IF p_qualification IS NULL THEN
      RAISE EXCEPTION 'Qualification details are required before promoting a contact';
    END IF;

    v_lead_id := public.promote_marketing_contact(
      m.contact_id, 'other'::lead_source, 'cold_call_' || p_disposition, v_profile_id);
    IF v_lead_id IS NULL THEN
      RAISE EXCEPTION 'Could not promote contact to a lead';
    END IF;
    v_promoted := true;

    UPDATE public.leads SET
      name             = COALESCE(NULLIF(btrim(p_qualification->>'name'), ''), name),
      course_id        = COALESCE(NULLIF(p_qualification->>'course_id', '')::uuid, course_id),
      campus_id        = COALESCE(NULLIF(p_qualification->>'campus_id', '')::uuid, campus_id),
      city             = COALESCE(NULLIF(btrim(p_qualification->>'city'), ''), city),
      first_contact_at = COALESCE(first_contact_at, now()),
      stage            = 'counsellor_call'
    WHERE id = v_lead_id;

    IF NULLIF(btrim(p_qualification->>'notes'), '') IS NOT NULL THEN
      INSERT INTO public.lead_notes (lead_id, user_id, content)
      VALUES (v_lead_id, v_uid, 'Cold call qualification: ' || (p_qualification->>'notes'));
    END IF;

    UPDATE public.call_logs
       SET lead_id = v_lead_id, contact_id = NULL
     WHERE contact_id = m.contact_id;
    UPDATE public.ai_call_records
       SET lead_id = v_lead_id, contact_id = NULL
     WHERE contact_id = m.contact_id;

    IF p_disposition = 'call_back'
       AND NULLIF(btrim(p_qualification->>'followup_at'), '') IS NOT NULL THEN
      INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, notes, status)
      VALUES (v_lead_id, v_uid, (p_qualification->>'followup_at')::timestamptz, 'call',
              'Cold call callback (attempt ' || v_attempt || ')', 'pending');
    END IF;

    v_work_status := 'worked';

  ELSIF p_disposition IN ('not_answered', 'busy', 'voicemail') THEN
    IF v_attempt >= c_max_attempts THEN
      v_work_status := 'worked';
    ELSE
      v_work_status := 'pending';
      v_next_attempt := public.clamp_to_business_hours(now() + interval '4 hours');
    END IF;

  ELSE
    v_work_status := 'worked';
  END IF;

  UPDATE public.lead_list_members SET
    work_status     = v_work_status,
    attempt_count   = v_attempt,
    worked_at       = now(),
    next_attempt_at = v_next_attempt,
    call_log_id     = COALESCE(v_call_log_id, call_log_id)
  WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'lead_id',         v_lead_id,
    'promoted',        v_promoted,
    'call_log_id',     v_call_log_id,
    'attempt_count',   v_attempt,
    'work_status',     v_work_status,
    'next_attempt_at', v_next_attempt
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cold_call_disposition(uuid, text, text, integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cold_call_disposition(uuid, text, text, integer, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
