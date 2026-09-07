-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905061936 name=cold_call_record_call_log_contact_param applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DROP FUNCTION IF EXISTS public.record_cloud_call_log(text,uuid,uuid,text,integer,text,text,text);
DROP FUNCTION IF EXISTS public.record_cloud_call_log(text,uuid,uuid,text,integer,text,text,text,text);

CREATE FUNCTION public.record_cloud_call_log(
  p_call_uuid text,
  p_lead_id uuid,
  p_user_id uuid,
  p_disposition text,
  p_duration integer,
  p_notes text,
  p_source text,
  p_recording_url text DEFAULT NULL::text,
  p_call_source text DEFAULT NULL::text,
  p_contact_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_call_uuid IS NULL THEN
    RAISE EXCEPTION 'p_call_uuid is required';
  END IF;
  IF (p_lead_id IS NULL) = (p_contact_id IS NULL) THEN
    RAISE EXCEPTION 'exactly one of p_lead_id / p_contact_id is required';
  END IF;
  IF p_source NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'p_source must be ''auto'' or ''manual''';
  END IF;
  IF p_call_source IS NOT NULL
     AND p_call_source NOT IN ('cloud_dialer', 'manual_log', 'inbound', 'cold_call') THEN
    RAISE EXCEPTION 'p_call_source must be NULL, ''cloud_dialer'', ''manual_log'', ''inbound'', or ''cold_call''';
  END IF;

  SELECT id INTO v_id
    FROM public.call_logs
   WHERE cloud_call_uuid = p_call_uuid
   LIMIT 1;

  IF p_disposition IN ('cancelled', 'cancelled_by_counsellor') THEN
    RETURN v_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.call_logs (
      lead_id, contact_id, user_id, direction,
      duration_seconds, disposition, recording_url, notes,
      cloud_call_uuid, source, called_at
    ) VALUES (
      p_lead_id, p_contact_id, p_user_id, 'outbound',
      COALESCE(p_duration, 0), p_disposition, p_recording_url, p_notes,
      p_call_uuid, p_call_source, now()
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_source = 'manual' THEN
    UPDATE public.call_logs
       SET disposition      = COALESCE(p_disposition, disposition),
           notes            = COALESCE(NULLIF(p_notes, ''), notes),
           user_id          = COALESCE(user_id, p_user_id),
           duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  ELSE
    UPDATE public.call_logs
       SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           recording_url    = COALESCE(recording_url, p_recording_url),
           disposition      = COALESCE(disposition, p_disposition),
           notes            = COALESCE(notes, p_notes),
           user_id          = COALESCE(user_id, p_user_id),
           source           = COALESCE(source, p_call_source)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text,uuid,uuid,text,integer,text,text,text,text,uuid)
  TO authenticated, service_role;

DO $do$
DECLARE
  v_lead    uuid;
  v_contact uuid;
  v_id      uuid;
BEGIN
  BEGIN
    SELECT id INTO v_lead FROM public.leads WHERE is_mirror = false LIMIT 1;
    SELECT id INTO v_contact FROM public.marketing_contacts LIMIT 1;

    IF v_lead IS NOT NULL THEN
      v_id := public.record_cloud_call_log(
        'smoke-' || gen_random_uuid()::text, v_lead, NULL, 'not_answered', 0,
        'phase2 smoke', 'auto', NULL, 'cloud_dialer');
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'SMOKE_FAIL: lead path returned NULL';
      END IF;
    END IF;

    IF v_contact IS NOT NULL THEN
      v_id := public.record_cloud_call_log(
        'smoke-' || gen_random_uuid()::text, NULL, NULL, 'not_answered', 0,
        'phase2 smoke cold', 'auto', NULL, 'cold_call', v_contact);
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'SMOKE_FAIL: contact path returned NULL';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.call_logs
                      WHERE id = v_id AND contact_id = v_contact AND lead_id IS NULL
                        AND source = 'cold_call') THEN
        RAISE EXCEPTION 'SMOKE_FAIL: cold row did not persist its contact target';
      END IF;
    END IF;

    BEGIN
      PERFORM public.record_cloud_call_log(
        'smoke-' || gen_random_uuid()::text, NULL, NULL, 'not_answered', 0,
        'x', 'auto', NULL, 'cold_call');
      RAISE EXCEPTION 'SMOKE_FAIL: XOR guard accepted two NULL targets';
    EXCEPTION WHEN others THEN
      IF SQLERRM LIKE 'SMOKE_FAIL%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'SMOKE_ROLLBACK';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'SMOKE_ROLLBACK' THEN RAISE; END IF;
  END;
END
$do$;

NOTIFY pgrst, 'reload schema';
