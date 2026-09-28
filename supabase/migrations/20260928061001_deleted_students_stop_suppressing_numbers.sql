-- A deleted student must not keep a phone number (or email) suppressed.
--
-- phone_comms_suppressed / lead_comms_suppressed / email_comms_suppressed /
-- wa_suppressed_phones treated a non-null deleted_at as a suppression
-- trigger. Suppression also matches through the student's linked lead's phone,
-- so the app's soft "Delete" left a removed student's (often shared) number
-- blocked for WhatsApp, email, OTP and — via phone_comms_suppressed in
-- whatsapp-otp — *login*. A number a removed student once used could therefore
-- never be used again by an active student.
--
-- New rule: a student suppresses only while they are NOT deleted and are
-- login-disabled or archived. Deletion is terminal and stops suppressing, even
-- if the row was archived first. Deleted rows keep their phone/whatsapp_no so
-- the admin phone-search recovery still finds them.

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
       AND s.deleted_at IS NULL
       AND (
         COALESCE(s.login_disabled, false)
         OR s.archived_at IS NOT NULL
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
        WHERE s.deleted_at IS NULL
          AND (
            COALESCE(s.login_disabled, false)
            OR s.archived_at IS NOT NULL
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
        WHERE s.deleted_at IS NULL
          AND (
            COALESCE(s.login_disabled, false)
            OR s.archived_at IS NOT NULL
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
-- login-disabled / archived student phones. Deleted students are excluded so a
-- removed student's number is not pinned forever.
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
   WHERE st.deleted_at IS NULL
     AND (
       COALESCE(st.login_disabled, false)
       OR st.archived_at IS NOT NULL
     )
  UNION
  SELECT i.phone
    FROM input i
    JOIN public.leads l ON public.wa_normalize_phone(l.phone) = i.phone
    JOIN public.students st ON st.lead_id = l.id
   WHERE st.deleted_at IS NULL
     AND (
       COALESCE(st.login_disabled, false)
       OR st.archived_at IS NOT NULL
     );
$$;

GRANT EXECUTE ON FUNCTION public.wa_suppressed_phones(text[]) TO authenticated, service_role;
