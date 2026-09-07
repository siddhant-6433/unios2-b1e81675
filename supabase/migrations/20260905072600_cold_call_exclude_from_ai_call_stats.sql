-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905072600 name=cold_call_exclude_from_ai_call_stats applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.ai_call_log_stats(
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to   timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', COUNT(*)::integer,
    'completed', COUNT(*) FILTER (WHERE status = 'completed')::integer,
    'withRecording', COUNT(*) FILTER (WHERE recording_url IS NOT NULL)::integer,
    'highConv', COUNT(*) FILTER (WHERE COALESCE(conversion_probability, 0) >= 60)::integer,
    'inbound', COUNT(*) FILTER (WHERE call_type = 'inbound')::integer
  )
  FROM public.ai_call_records
  WHERE status <> 'counsellor_no_answer'
    AND contact_id IS NULL
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to);
$function$;

NOTIFY pgrst, 'reload schema';
