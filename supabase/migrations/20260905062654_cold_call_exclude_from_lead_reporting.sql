-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905062654 name=cold_call_exclude_from_lead_reporting applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

DO $do$
DECLARE
  r     record;
  v_def text;
  v_new text;
  v_src constant text := '(SELECT * FROM public.call_logs WHERE source IS DISTINCT FROM ''cold_call'')';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_counsellor_activity_log',
                        'counsellor_calling_summary_base',
                        'assignable_counsellors',
                        'fn_snapshot_daily_kpis',
                        'call_log_metrics')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'public.call_logs cl', v_src || ' cl');
    v_new := replace(v_new, 'public.call_logs c2', v_src || ' c2');
    v_new := regexp_replace(v_new, '([^.])call_logs cl', '\1' || v_src || ' cl', 'g');
    v_new := regexp_replace(v_new, '([^.])call_logs c2', '\1' || v_src || ' c2', 'g');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'phase3: no call_logs anchor matched in function %', r.proname;
    END IF;
    EXECUTE v_new;
    RAISE NOTICE 'phase3: patched function %', r.proname;
  END LOOP;

  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND c.relname IN ('counsellor_performance_stats', 'counsellor_dialer_usage')
  LOOP
    v_def := pg_get_viewdef(r.oid);
    v_new := replace(v_def, 'public.call_logs cl', v_src || ' cl');
    v_new := regexp_replace(v_new, '([^.])call_logs cl', '\1' || v_src || ' cl', 'g');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'phase3: no call_logs anchor matched in view %', r.relname;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.' || quote_ident(r.relname) || ' AS ' || v_new;
    RAISE NOTICE 'phase3: patched view %', r.relname;
  END LOOP;
END
$do$;

CREATE OR REPLACE FUNCTION public.cold_call_report(
  _from date,
  _to   date,
  _profile_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id          uuid,
  counsellor_name  text,
  dials            integer,
  connects         integer,
  interested       integer,
  not_interested   integer,
  call_back        integer,
  no_answer        integer,
  promoted         integer,
  talk_seconds     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    cl.user_id,
    COALESCE(p.display_name, 'Unknown')::text,
    count(*)::int,
    count(*) FILTER (WHERE COALESCE(cl.duration_seconds, 0) > 0)::int,
    count(*) FILTER (WHERE cl.disposition = 'interested')::int,
    count(*) FILTER (WHERE cl.disposition = 'not_interested')::int,
    count(*) FILTER (WHERE cl.disposition = 'call_back')::int,
    count(*) FILTER (WHERE cl.disposition = 'not_answered')::int,
    count(*) FILTER (WHERE cl.lead_id IS NOT NULL)::int,
    COALESCE(sum(cl.duration_seconds), 0)::bigint
  FROM public.call_logs cl
  LEFT JOIN public.profiles p ON p.user_id = cl.user_id
  WHERE cl.source = 'cold_call'
    AND cl.called_at >= _from::timestamptz
    AND cl.called_at <  (_to + 1)::timestamptz
    AND (_profile_id IS NULL OR p.id = _profile_id)
  GROUP BY cl.user_id, p.display_name
  ORDER BY count(*) DESC;
$function$;

REVOKE ALL ON FUNCTION public.cold_call_report(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cold_call_report(date, date, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
