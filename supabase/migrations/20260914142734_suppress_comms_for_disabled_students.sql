-- Login-disabled, archived, or deleted students must not receive WhatsApp,
-- email, OTP, inbox replies, campaigns, or lifecycle notify-event messages.

CREATE OR REPLACE FUNCTION public.lead_comms_suppressed(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.students s
     WHERE s.lead_id = _lead_id
       AND (
         COALESCE(s.login_disabled, false)
         OR s.archived_at IS NOT NULL
         OR s.deleted_at IS NOT NULL
       )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.phone_comms_suppressed(_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public.wa_normalize_phone(_phone) <> ''
     AND EXISTS (
       SELECT 1
         FROM public.students s
         LEFT JOIN public.leads l ON l.id = s.lead_id
        WHERE (
          COALESCE(s.login_disabled, false)
          OR s.archived_at IS NOT NULL
          OR s.deleted_at IS NOT NULL
        )
          AND public.wa_normalize_phone(_phone) IN (
            public.wa_normalize_phone(s.phone),
            public.wa_normalize_phone(s.whatsapp_no),
            public.wa_normalize_phone(l.phone)
          )
     );
$fn$;

CREATE OR REPLACE FUNCTION public.email_comms_suppressed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(lower(btrim(_email)), '') <> ''
     AND EXISTS (
       SELECT 1
         FROM public.students s
         LEFT JOIN public.leads l ON l.id = s.lead_id
        WHERE (
          COALESCE(s.login_disabled, false)
          OR s.archived_at IS NOT NULL
          OR s.deleted_at IS NOT NULL
        )
          AND lower(btrim(_email)) IN (
            lower(btrim(COALESCE(s.email, ''))),
            lower(btrim(COALESCE(s.student_email, ''))),
            lower(btrim(COALESCE(s.school_email, ''))),
            lower(btrim(COALESCE(l.email, '')))
          )
     );
$fn$;

GRANT EXECUTE ON FUNCTION public.lead_comms_suppressed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.phone_comms_suppressed(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_comms_suppressed(text) TO authenticated, service_role;

-- Campaign audience preview / batch skip: union marketing-fatigue with
-- login-disabled / archived / deleted student phones.
CREATE OR REPLACE FUNCTION public.wa_suppressed_phones(_phones text[])
RETURNS TABLE(phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT DISTINCT public.wa_normalize_phone(p) AS phone
      FROM unnest(_phones) AS p
     WHERE public.wa_normalize_phone(p) <> ''
  )
  SELECT i.phone
    FROM input i
    JOIN public.whatsapp_send_suppression s ON s.phone = i.phone
   WHERE s.until IS NOT NULL
     AND s.until > now()
  UNION
  SELECT i.phone
    FROM input i
    JOIN public.students st
      ON i.phone IN (
           public.wa_normalize_phone(st.phone),
           public.wa_normalize_phone(st.whatsapp_no)
         )
   WHERE COALESCE(st.login_disabled, false)
      OR st.archived_at IS NOT NULL
      OR st.deleted_at IS NOT NULL
  UNION
  SELECT i.phone
    FROM input i
    JOIN public.leads l ON public.wa_normalize_phone(l.phone) = i.phone
    JOIN public.students st ON st.lead_id = l.id
   WHERE COALESCE(st.login_disabled, false)
      OR st.archived_at IS NOT NULL
      OR st.deleted_at IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.wa_suppressed_phones(text[]) TO authenticated, service_role;

-- Lifecycle triggers (PAN issued, admission issued, fee receipts, etc.)
-- must not POST notify-event for suppressed candidates.
CREATE OR REPLACE FUNCTION public.fn_notify_event(
  _event       text,
  _lead_id     uuid,
  _context     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url    text;
  v_service_key text;
BEGIN
  IF _lead_id IS NULL THEN RETURN; END IF;
  IF public.lead_comms_suppressed(_lead_id) THEN RETURN; END IF;

  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/notify-event',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'event',   _event,
      'lead_id', _lead_id,
      'context', _context
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_notify_event(% , %) failed: %', _event, _lead_id, SQLERRM;
END;
$$;
