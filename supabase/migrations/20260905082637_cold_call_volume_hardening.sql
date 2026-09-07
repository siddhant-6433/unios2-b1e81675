-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905082637 name=cold_call_volume_hardening applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE INDEX IF NOT EXISTS idx_marketing_contacts_last_contacted
  ON public.marketing_contacts (last_contacted_at)
  WHERE last_contacted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cloud_dialer_campaign_queue(
  p_list_id       uuid,
  p_counsellor_id uuid    DEFAULT NULL,
  p_limit         integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_admin   boolean;
  v_result     jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

  WITH cfg AS (
    SELECT COALESCE(include_terminal, false) AS include_terminal
    FROM public.lead_lists WHERE id = p_list_id
  ),
  members AS (
    SELECT m.id AS member_id, m.lead_id, m.contact_id, m.sort_order, m.added_at,
           m.attempt_count, m.next_attempt_at
    FROM public.lead_list_members m
    LEFT JOIN public.leads l              ON l.id = m.lead_id
    LEFT JOIN public.marketing_contacts c ON c.id = m.contact_id
    CROSS JOIN cfg
    WHERE m.list_id = p_list_id
      AND m.work_status = 'pending'
      AND (m.next_attempt_at IS NULL OR m.next_attempt_at <= now())
      AND CASE
            WHEN m.contact_id IS NOT NULL
              THEN c.phone IS NOT NULL AND NOT c.opted_out AND c.promoted_lead_id IS NULL
            ELSE l.phone IS NOT NULL
                 AND (cfg.include_terminal
                      OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted'))
          END
      AND (
        m.contact_id IS NULL
        OR m.attempt_count > 0
        OR c.last_contacted_at IS NULL
        OR c.last_contacted_at < now() - interval '30 days'
      )
      AND (
        (v_is_admin AND (p_counsellor_id IS NULL OR m.assigned_to = p_counsellor_id))
        OR (NOT v_is_admin AND m.assigned_to = v_profile_id)
      )
    ORDER BY m.next_attempt_at NULLS FIRST, m.sort_order NULLS LAST, m.added_at
    LIMIT GREATEST(1, LEAST(p_limit, 1000))
  ),
  enriched AS (
    SELECT
      COALESCE(m.lead_id, m.contact_id) AS id,
      m.member_id,
      CASE WHEN m.contact_id IS NOT NULL THEN 'contact' ELSE 'lead' END AS kind,
      COALESCE(l.name, c.name)          AS name,
      COALESCE(l.phone, c.phone)        AS phone,
      COALESCE(l.stage::text, '')       AS stage,
      COALESCE(l.source::text, 'cold_list') AS source,
      COALESCE(l.city, c.city)          AS city,
      l.course_id,
      COALESCE(co.name, '—')            AS course_name,
      co.fee_per_year                   AS course_fee_per_year,
      COALESCE(cmp.name, '—')           AS campus_name,
      CASE WHEN m.contact_id IS NOT NULL THEN 'Cold List' ELSE 'Call List' END AS bucket,
      0                                 AS bucket_priority,
      COALESCE(m.attempt_count, 0)      AS attempt_count,
      l.assigned_at, l.first_contact_at,
      NULL::uuid AS followup_id,
      NULL::text AS followup_type,
      row_number() OVER (ORDER BY m.next_attempt_at NULLS FIRST,
                                  m.sort_order NULLS LAST, m.added_at) AS list_position
    FROM members m
    LEFT JOIN public.leads l              ON l.id  = m.lead_id
    LEFT JOIN public.marketing_contacts c ON c.id  = m.contact_id
    LEFT JOIN public.courses co           ON co.id = l.course_id
    LEFT JOIN public.campuses cmp         ON cmp.id = l.campus_id
  )
  SELECT jsonb_build_object(
    'queue', COALESCE(
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.list_position) FROM enriched e),
      '[]'::jsonb
    ),
    'buckets', CASE
      WHEN (SELECT count(*) FROM enriched) > 0 THEN jsonb_build_array(jsonb_build_object(
        'bucket_priority', 0, 'label', 'Call List',
        'count', (SELECT count(*)::int FROM enriched)
      ))
      ELSE '[]'::jsonb
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cloud_dialer_campaign_queue(uuid, uuid, integer) TO authenticated, service_role;

ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS pending_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS worked_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS not_dialable_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_worked_at     timestamptz;

CREATE OR REPLACE FUNCTION public.lead_lists_work_counts_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.lead_lists ll SET
    pending_count      = ll.pending_count      + d.p,
    worked_count       = ll.worked_count       + d.w,
    skipped_count      = ll.skipped_count      + d.s,
    not_dialable_count = ll.not_dialable_count + d.n,
    last_worked_at     = GREATEST(ll.last_worked_at, d.lw)
  FROM (
    SELECT list_id,
           count(*) FILTER (WHERE work_status = 'pending')::int      AS p,
           count(*) FILTER (WHERE work_status = 'worked')::int       AS w,
           count(*) FILTER (WHERE work_status = 'skipped')::int      AS s,
           count(*) FILTER (WHERE work_status = 'not_dialable')::int AS n,
           max(worked_at)                                            AS lw
    FROM new_rows GROUP BY list_id
  ) d
  WHERE ll.id = d.list_id;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_lists_work_counts_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.lead_lists ll SET
    pending_count      = GREATEST(ll.pending_count      - d.p, 0),
    worked_count       = GREATEST(ll.worked_count       - d.w, 0),
    skipped_count      = GREATEST(ll.skipped_count      - d.s, 0),
    not_dialable_count = GREATEST(ll.not_dialable_count - d.n, 0)
  FROM (
    SELECT list_id,
           count(*) FILTER (WHERE work_status = 'pending')::int      AS p,
           count(*) FILTER (WHERE work_status = 'worked')::int       AS w,
           count(*) FILTER (WHERE work_status = 'skipped')::int      AS s,
           count(*) FILTER (WHERE work_status = 'not_dialable')::int AS n
    FROM old_rows GROUP BY list_id
  ) d
  WHERE ll.id = d.list_id;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_lists_work_counts_upd()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  UPDATE public.lead_lists ll SET
    pending_count      = GREATEST(ll.pending_count      + d.p, 0),
    worked_count       = GREATEST(ll.worked_count       + d.w, 0),
    skipped_count      = GREATEST(ll.skipped_count      + d.s, 0),
    not_dialable_count = GREATEST(ll.not_dialable_count + d.n, 0),
    last_worked_at     = GREATEST(ll.last_worked_at, d.lw)
  FROM (
    SELECT list_id,
           sum(sign) FILTER (WHERE work_status = 'pending')::int      AS p,
           sum(sign) FILTER (WHERE work_status = 'worked')::int       AS w,
           sum(sign) FILTER (WHERE work_status = 'skipped')::int      AS s,
           sum(sign) FILTER (WHERE work_status = 'not_dialable')::int AS n,
           max(worked_at) FILTER (WHERE sign = 1)                     AS lw
    FROM (
      SELECT list_id, work_status, worked_at,  1 AS sign FROM new_rows
      UNION ALL
      SELECT list_id, work_status, worked_at, -1 AS sign FROM old_rows
    ) z GROUP BY list_id
  ) d
  WHERE ll.id = d.list_id;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_llm_work_counts_ins ON public.lead_list_members;
CREATE TRIGGER trg_llm_work_counts_ins
  AFTER INSERT ON public.lead_list_members
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_work_counts_ins();

DROP TRIGGER IF EXISTS trg_llm_work_counts_del ON public.lead_list_members;
CREATE TRIGGER trg_llm_work_counts_del
  AFTER DELETE ON public.lead_list_members
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_work_counts_del();

DROP TRIGGER IF EXISTS trg_llm_work_counts_upd ON public.lead_list_members;
CREATE TRIGGER trg_llm_work_counts_upd
  AFTER UPDATE ON public.lead_list_members
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_work_counts_upd();

CREATE OR REPLACE FUNCTION public.reconcile_lead_list_work_counts(_list_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('statement_timeout', '300s', true);
  WITH agg AS (
    SELECT ll.id AS list_id,
           count(m.*) FILTER (WHERE m.work_status = 'pending')::int      AS p,
           count(m.*) FILTER (WHERE m.work_status = 'worked')::int       AS w,
           count(m.*) FILTER (WHERE m.work_status = 'skipped')::int      AS s,
           count(m.*) FILTER (WHERE m.work_status = 'not_dialable')::int AS n,
           max(m.worked_at)                                              AS lw
    FROM public.lead_lists ll
    LEFT JOIN public.lead_list_members m ON m.list_id = ll.id
    WHERE _list_id IS NULL OR ll.id = _list_id
    GROUP BY ll.id
  ),
  upd AS (
    UPDATE public.lead_lists ll SET
      pending_count = agg.p, worked_count = agg.w,
      skipped_count = agg.s, not_dialable_count = agg.n,
      last_worked_at = agg.lw
    FROM agg WHERE ll.id = agg.list_id
      AND (ll.pending_count, ll.worked_count, ll.skipped_count, ll.not_dialable_count)
          IS DISTINCT FROM (agg.p, agg.w, agg.s, agg.n)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM upd;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_lead_list_work_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_lead_list_work_counts(uuid) TO authenticated, service_role;

SELECT public.reconcile_lead_list_work_counts(NULL);

CREATE OR REPLACE FUNCTION public.my_call_lists()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id uuid;
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1;

  v_is_admin := public.has_role(auth.uid(), 'super_admin'::public.app_role)
             OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
             OR public.has_role(auth.uid(), 'principal'::public.app_role)
             OR public.has_role(auth.uid(), 'campus_admin'::public.app_role)
             OR EXISTS (SELECT 1 FROM public.teams t WHERE t.leader_id = v_profile_id);

  IF v_is_admin THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.due_date NULLS LAST, x.pending DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT ll.id, ll.name, ll.priority_note, ll.due_date,
             ll.member_count::int                                      AS total,
             GREATEST(ll.member_count - ll.not_dialable_count, 0)::int AS dialable,
             ll.pending_count::int                                     AS pending,
             ll.worked_count::int                                      AS worked,
             ll.skipped_count::int                                     AS skipped,
             ll.not_dialable_count::int                                AS not_dialable,
             ll.last_worked_at
      FROM public.lead_lists ll
      WHERE ll.purpose = 'calling'
        AND ll.is_active
        AND (ll.pending_count > 0 OR ll.last_worked_at > now() - interval '7 days')
    ) x;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.due_date NULLS LAST, x.pending DESC), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT
        ll.id, ll.name, ll.priority_note, ll.due_date,
        count(*)::int                                                AS total,
        count(*) FILTER (WHERE m.work_status <> 'not_dialable')::int AS dialable,
        count(*) FILTER (WHERE m.work_status = 'pending')::int       AS pending,
        count(*) FILTER (WHERE m.work_status = 'worked')::int        AS worked,
        count(*) FILTER (WHERE m.work_status = 'skipped')::int       AS skipped,
        count(*) FILTER (WHERE m.work_status = 'not_dialable')::int  AS not_dialable,
        max(m.worked_at)                                             AS last_worked_at
      FROM public.lead_lists ll
      JOIN public.lead_list_members m ON m.list_id = ll.id
      WHERE ll.purpose = 'calling'
        AND ll.is_active
        AND m.assigned_to = v_profile_id
      GROUP BY ll.id, ll.name, ll.priority_note, ll.due_date
      HAVING count(*) FILTER (WHERE m.work_status = 'pending') > 0
          OR max(m.worked_at) > now() - interval '7 days'
    ) x;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.my_call_lists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_call_lists() TO authenticated, service_role;

ANALYZE public.lead_lists;

NOTIFY pgrst, 'reload schema';
