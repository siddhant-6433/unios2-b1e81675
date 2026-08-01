-- Fix 1a: find_lead_duplicates — add extensions to search_path so similarity() is found
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
SET search_path = public, extensions
AS $$
DECLARE
  v_phone_digits text;
  v_email_lower text;
  v_email_local text;
  v_email_domain text;
BEGIN
  v_phone_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
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
      CASE
        WHEN v_phone_digits != '' AND length(v_phone_digits) >= 10
             AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_phone_digits
        THEN 0.50
        ELSE 0.0
      END AS phone_score,
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
      CASE
        WHEN p_name IS NOT NULL AND length(p_name) >= 3 AND l.name IS NOT NULL
        THEN LEAST(similarity(l.name, p_name)::float * 0.25, 0.25)
        ELSE 0.0
      END AS name_score,
      CASE
        WHEN v_phone_digits != '' AND length(v_phone_digits) >= 10
             AND l.guardian_phone IS NOT NULL
             AND right(regexp_replace(l.guardian_phone, '\D', '', 'g'), 10) = v_phone_digits
        THEN 0.15
        ELSE 0.0
      END AS guardian_phone_score
    FROM leads l
    WHERE l.id != COALESCE(p_lead_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        (v_phone_digits != '' AND length(v_phone_digits) >= 10 AND (
          right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_phone_digits
          OR (l.guardian_phone IS NOT NULL AND right(regexp_replace(l.guardian_phone, '\D', '', 'g'), 10) = v_phone_digits)
        ))
        OR (v_email_lower != '' AND l.email IS NOT NULL AND lower(trim(l.email)) = v_email_lower)
        OR (v_email_local IS NOT NULL AND v_email_local != '' AND length(v_email_local) >= 3
            AND l.email IS NOT NULL AND split_part(lower(trim(l.email)), '@', 1) = v_email_local)
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

-- Fix 1b: find_name_duplicates — add extensions to search_path so similarity() is found
CREATE OR REPLACE FUNCTION public.find_name_duplicates(p_name text, p_exclude_id uuid DEFAULT NULL, p_threshold float DEFAULT 0.4)
RETURNS TABLE(id uuid, name text, phone text, stage text, similarity float)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT l.id, l.name, l.phone, l.stage::text, similarity(l.name, p_name)::float
  FROM public.leads l
  WHERE l.id != COALESCE(p_exclude_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND similarity(l.name, p_name) > p_threshold
  ORDER BY similarity(l.name, p_name) DESC
  LIMIT 10;
END;
$$;

-- Fix 2: create_whatsapp_sla_alerts — replace max(uuid) with max(lead_id::text)::uuid
--         PG does not have a built-in max() aggregate for uuid.
CREATE OR REPLACE FUNCTION public.create_whatsapp_sla_alerts(
  p_warning_after interval default interval '5 minutes',
  p_breach_after interval default interval '15 minutes',
  p_reply_window_expiring_within interval default interval '2 hours'
)
RETURNS TABLE (
  warnings_created integer,
  breaches_created integer,
  expiring_created integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warning_count integer := 0;
  v_breach_count integer := 0;
  v_expiring_count integer := 0;
BEGIN
  WITH conversations AS (
    SELECT
      wm.phone,
      max(wm.provider) AS provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') AS business_number,
      (max(wm.lead_id::text) FILTER (WHERE wm.lead_id IS NOT NULL))::uuid AS lead_id,
      max(wm.created_at) FILTER (WHERE wm.direction = 'inbound') AS last_inbound_at,
      max(wm.created_at) FILTER (WHERE wm.direction = 'outbound') AS last_outbound_at
    FROM public.whatsapp_messages wm
    WHERE wm.created_at >= now() - interval '26 hours'
    GROUP BY wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable AS (
    SELECT
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + p_warning_after AS warning_due_at,
      c.last_inbound_at + p_breach_after AS breach_due_at,
      c.last_inbound_at + interval '24 hours' AS reply_window_closes_at
    FROM conversations c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE c.last_inbound_at IS NOT NULL
      AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
      AND c.last_inbound_at + interval '24 hours' > now()
      AND coalesce(l.stage::text, '') <> 'dnc'
      AND p.user_id IS NOT NULL
  ), warning_notifications AS (
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    SELECT
      a.user_id,
      'whatsapp_sla_warning',
      'WhatsApp reply due',
      'Inbound WhatsApp message has not been replied to for 5 minutes. Reply while the Meta 24h window is open.',
      '/whatsapp-inbox',
      a.lead_id
    FROM actionable a
    WHERE now() >= a.warning_due_at
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_sla_alerts s
        WHERE s.phone = a.phone
          AND coalesce(s.business_number, '') = coalesce(a.business_number, '')
          AND s.alert_type = 'warning'
          AND s.last_inbound_at = a.last_inbound_at
      )
    RETURNING id, user_id, lead_id
  ), warning_alerts AS (
    INSERT INTO public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    SELECT a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'warning', a.last_inbound_at, a.warning_due_at, n.id
    FROM actionable a
    JOIN warning_notifications n ON n.user_id = a.user_id AND n.lead_id IS NOT DISTINCT FROM a.lead_id
    WHERE now() >= a.warning_due_at
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_warning_count FROM warning_alerts;

  WITH conversations AS (
    SELECT
      wm.phone,
      max(wm.provider) AS provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') AS business_number,
      (max(wm.lead_id::text) FILTER (WHERE wm.lead_id IS NOT NULL))::uuid AS lead_id,
      max(wm.created_at) FILTER (WHERE wm.direction = 'inbound') AS last_inbound_at,
      max(wm.created_at) FILTER (WHERE wm.direction = 'outbound') AS last_outbound_at
    FROM public.whatsapp_messages wm
    WHERE wm.created_at >= now() - interval '26 hours'
    GROUP BY wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable AS (
    SELECT
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + p_breach_after AS breach_due_at,
      c.last_inbound_at + interval '24 hours' AS reply_window_closes_at
    FROM conversations c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE c.last_inbound_at IS NOT NULL
      AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
      AND c.last_inbound_at + interval '24 hours' > now()
      AND coalesce(l.stage::text, '') <> 'dnc'
      AND p.user_id IS NOT NULL
  ), breach_notifications AS (
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    SELECT
      a.user_id,
      'whatsapp_sla_breach',
      'WhatsApp SLA breached',
      'Inbound WhatsApp message has waited 15 minutes without a reply. Prioritise this conversation now.',
      '/whatsapp-inbox',
      a.lead_id
    FROM actionable a
    WHERE now() >= a.breach_due_at
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_sla_alerts s
        WHERE s.phone = a.phone
          AND coalesce(s.business_number, '') = coalesce(a.business_number, '')
          AND s.alert_type = 'breach'
          AND s.last_inbound_at = a.last_inbound_at
      )
    RETURNING id, user_id, lead_id
  ), breach_alerts AS (
    INSERT INTO public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    SELECT a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'breach', a.last_inbound_at, a.breach_due_at, n.id
    FROM actionable a
    JOIN breach_notifications n ON n.user_id = a.user_id AND n.lead_id IS NOT DISTINCT FROM a.lead_id
    WHERE now() >= a.breach_due_at
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_breach_count FROM breach_alerts;

  WITH conversations AS (
    SELECT
      wm.phone,
      max(wm.provider) AS provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') AS business_number,
      (max(wm.lead_id::text) FILTER (WHERE wm.lead_id IS NOT NULL))::uuid AS lead_id,
      max(wm.created_at) FILTER (WHERE wm.direction = 'inbound') AS last_inbound_at,
      max(wm.created_at) FILTER (WHERE wm.direction = 'outbound') AS last_outbound_at
    FROM public.whatsapp_messages wm
    WHERE wm.created_at >= now() - interval '26 hours'
    GROUP BY wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable AS (
    SELECT
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + interval '24 hours' AS reply_window_closes_at
    FROM conversations c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE c.last_inbound_at IS NOT NULL
      AND (c.last_outbound_at IS NULL OR c.last_outbound_at < c.last_inbound_at)
      AND c.last_inbound_at + interval '24 hours' > now()
      AND c.last_inbound_at + interval '24 hours' <= now() + p_reply_window_expiring_within
      AND coalesce(l.stage::text, '') <> 'dnc'
      AND p.user_id IS NOT NULL
  ), expiring_notifications AS (
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    SELECT
      a.user_id,
      'whatsapp_sla_warning',
      'WhatsApp 24h window expiring',
      'This conversation is unreplied and the Meta free-form reply window closes within 2 hours. Reply now or prepare an approved template.',
      '/whatsapp-inbox',
      a.lead_id
    FROM actionable a
    WHERE NOT EXISTS (
        SELECT 1 FROM public.whatsapp_sla_alerts s
        WHERE s.phone = a.phone
          AND coalesce(s.business_number, '') = coalesce(a.business_number, '')
          AND s.alert_type = 'reply_window_expiring'
          AND s.last_inbound_at = a.last_inbound_at
      )
    RETURNING id, user_id, lead_id
  ), expiring_alerts AS (
    INSERT INTO public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    SELECT a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'reply_window_expiring', a.last_inbound_at, a.reply_window_closes_at, n.id
    FROM actionable a
    JOIN expiring_notifications n ON n.user_id = a.user_id AND n.lead_id IS NOT DISTINCT FROM a.lead_id
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_expiring_count FROM expiring_alerts;

  RETURN QUERY SELECT v_warning_count, v_breach_count, v_expiring_count;
END;
$$;
