-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905082853 name=release_call_list_members_on_counsellor_disable applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.fn_release_call_list_members_on_disable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.login_disabled, false) AND NOT COALESCE(OLD.login_disabled, false) THEN
    UPDATE public.lead_list_members
       SET assigned_to = NULL
     WHERE assigned_to = NEW.id
       AND work_status = 'pending';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_release_call_list_on_disable ON public.profiles;
CREATE TRIGGER trg_release_call_list_on_disable
  AFTER UPDATE OF login_disabled ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_release_call_list_members_on_disable();

CREATE OR REPLACE FUNCTION public.call_list_progress(p_list_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH members AS (
    SELECT * FROM public.lead_list_members m WHERE m.list_id = p_list_id
  ),
  latest_call AS (
    SELECT m.id AS member_id, cl.disposition, cl.called_at
    FROM members m
    JOIN public.call_logs cl ON cl.id = m.call_log_id
    WHERE m.work_status = 'worked'
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (m.id) m.id AS member_id, cl.disposition, cl.called_at
      FROM members m
      JOIN public.profiles cp ON cp.id = m.assigned_to
      JOIN public.call_logs cl
        ON cl.lead_id = m.lead_id
       AND cl.user_id = cp.user_id
       AND (m.assigned_at IS NULL OR cl.called_at >= m.assigned_at)
      WHERE m.work_status = 'worked'
        AND m.call_log_id IS NULL
        AND m.lead_id IS NOT NULL
      ORDER BY m.id, cl.called_at DESC
    ) fallback
  )
  SELECT jsonb_build_object(
    'list_id', p_list_id,
    'total',   (SELECT count(*)::int FROM members),
    'dialable', (SELECT count(*) FILTER (WHERE work_status <> 'not_dialable')::int FROM members),
    'pending', (SELECT count(*) FILTER (WHERE work_status = 'pending')::int FROM members),
    'worked',  (SELECT count(*) FILTER (WHERE work_status = 'worked')::int  FROM members),
    'skipped', (SELECT count(*) FILTER (WHERE work_status = 'skipped')::int FROM members),
    'not_dialable', (SELECT count(*) FILTER (WHERE work_status = 'not_dialable')::int FROM members),
    'unassigned_pending', (SELECT count(*) FILTER (WHERE work_status = 'pending' AND assigned_to IS NULL)::int FROM members),
    'last_call_at', (SELECT max(called_at) FROM latest_call),
    'dispositions', COALESCE((
      SELECT jsonb_object_agg(COALESCE(disposition, 'unrecorded'), n ORDER BY n DESC)
      FROM (SELECT disposition, count(*)::int AS n FROM latest_call GROUP BY disposition) z
    ), '{}'::jsonb),
    'by_counsellor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unassigned'),
        'total',   c.total,
        'worked',  c.worked,
        'pending', c.pending
      ) ORDER BY c.pending DESC)
      FROM (
        SELECT m2.assigned_to,
               count(*) FILTER (WHERE m2.work_status <> 'not_dialable')::int AS total,
               count(*) FILTER (WHERE m2.work_status = 'worked')::int  AS worked,
               count(*) FILTER (WHERE m2.work_status = 'pending')::int AS pending
        FROM members m2
        WHERE m2.assigned_to IS NOT NULL
        GROUP BY m2.assigned_to
      ) c
      JOIN public.profiles p ON p.id = c.assigned_to
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.call_list_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_list_progress(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
