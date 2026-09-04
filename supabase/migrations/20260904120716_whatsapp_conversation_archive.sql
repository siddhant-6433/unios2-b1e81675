-- Archive/close a WhatsApp conversation so it drops out of the inbox, and
-- have it auto-reappear the moment the candidate sends a new inbound message.
-- Reappearance is a pure timestamp compare (no webhook changes needed):
--
--   hidden iff archived_at IS NOT NULL
--            AND (last_inbound_at IS NULL OR last_inbound_at <= archived_at)
--
-- archived_at/archived_by live on whatsapp_conversation_state, keyed
-- (phone, business_number). business_number MUST be the canonical
-- whatsapp_conversation_key(provider, business_phone_number_id,
-- business_phone_number) format — the same format every other consumer of
-- this table uses (get_whatsapp_conversations, whatsapp_reply_state_counts,
-- whatsapp_inbox_category_counts). set_whatsapp_conversation_archived stores
-- p_business_number as-is, so the frontend must pass that canonical key, not
-- whatsapp_inbox_page's differently-ordered "business_number" output column.
-- This feature never touches mode/state/lead_id on the row.

ALTER TABLE public.whatsapp_conversation_state ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.whatsapp_conversation_state ADD COLUMN IF NOT EXISTS archived_by uuid;

-- ---------------------------------------------------------------------------
-- 1. Upsert RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_whatsapp_conversation_archived(
  p_phone text,
  p_business_number text,
  p_provider text DEFAULT 'meta',
  p_archived boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_business_number text := coalesce(nullif(p_business_number, ''), 'unknown');
BEGIN
  IF v_phone = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_conversation_state (
    phone, business_number, provider, archived_at, archived_by, updated_by, updated_at
  ) VALUES (
    v_phone,
    v_business_number,
    coalesce(nullif(p_provider, ''), 'meta'),
    CASE WHEN p_archived THEN now() ELSE NULL END,
    auth.uid(),
    auth.uid(),
    now()
  )
  ON CONFLICT (phone, business_number) DO UPDATE
    SET archived_at = EXCLUDED.archived_at,
        archived_by = EXCLUDED.archived_by,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_whatsapp_conversation_archived(text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_conversation_archived(text, text, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. whatsapp_inbox_page — hide archived conversations unless a fresh inbound
--    bumped last_inbound_at past archived_at; expose archived_at; add an
--    'archived' ops filter branch to look at them.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.whatsapp_inbox_page(text, text, text, text, timestamptz, text, integer);

CREATE OR REPLACE FUNCTION public.whatsapp_inbox_page(
  p_scope text default 'inbox',
  p_business_number text default 'all',
  p_counsellor_filter text default 'all',
  p_ops_filter text default 'all',
  p_cursor_at timestamptz default null,
  p_cursor_phone text default null,
  p_limit integer default 120
)
returns table (
  phone text,
  provider text,
  business_number text,
  conversation_key text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  lead_source text,
  course_name text,
  counsellor_id uuid,
  counsellor_name text,
  lead_temperature text,
  lead_score integer,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer,
  unreplied_count integer,
  reply_window_expires_at timestamptz,
  reply_window_open boolean,
  priority_rank integer,
  conversation_mode text,
  conversation_state text,
  handoff_reason text,
  last_bot_action text,
  render_preview jsonb,
  archived_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      wc.*,
      coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown') as resolved_business_number,
      l.lead_score,
      l.lead_temperature,
      (
        select max(m.created_at)
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.direction = 'inbound'
          and coalesce(m.provider, 'meta') = coalesce(wc.provider, 'meta')
          and coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), 'unknown')
            = coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown')
      ) as last_inbound_at,
      (
        select max(m.created_at)
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.direction = 'outbound'
          and coalesce(m.provider, 'meta') = coalesce(wc.provider, 'meta')
          and coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), 'unknown')
            = coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown')
      ) as last_outbound_at,
      (
        select m.render_metadata
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.message_type = 'template'
          and m.render_metadata is not null
        order by m.created_at desc
        limit 1
      ) as latest_render_metadata,
      cas.archived_at as archived_at
    from public.whatsapp_conversations wc
    left join public.leads l on l.id = wc.lead_id
    left join public.whatsapp_conversation_state cas
      on cas.phone = wc.phone
     and cas.business_number = public.whatsapp_conversation_key(coalesce(wc.provider, 'meta'), wc.business_phone_number_id, wc.business_phone_number)
  ), scored as (
    select
      base.*,
      (base.last_inbound_at + interval '24 hours') as reply_window_expires_at,
      (base.last_inbound_at is not null and base.last_inbound_at + interval '24 hours' > now()) as reply_window_open,
      case
        when base.last_direction = 'inbound'
          and base.last_inbound_at is not null
          and base.last_inbound_at + interval '24 hours' > now()
          then 1
        when base.last_direction = 'inbound' then 2
        when base.conversation_state = 'knowledge_gap' or base.last_bot_action = 'knowledge_gap' then 3
        when base.handoff_reason is not null or base.conversation_mode = 'human' then 4
        else 9
      end as priority_rank,
      case
        when base.last_direction = 'inbound'
          and (base.last_outbound_at is null or base.last_outbound_at < base.last_inbound_at)
          then 1
        else 0
      end as unreplied_count
    from base
  )
  select
    scored.phone,
    coalesce(scored.provider, 'meta')::text,
    scored.resolved_business_number::text,
    public.whatsapp_stable_conversation_key(scored.phone, coalesce(scored.provider, 'meta'), scored.resolved_business_number),
    scored.lead_id,
    scored.lead_name,
    scored.lead_stage,
    scored.lead_person_role,
    scored.lead_source,
    scored.course_name,
    scored.counsellor_id,
    scored.counsellor_name,
    scored.lead_temperature,
    scored.lead_score,
    scored.last_message,
    scored.last_direction,
    scored.last_message_at,
    scored.last_inbound_at,
    scored.last_outbound_at,
    scored.unread_count::integer,
    scored.unreplied_count::integer,
    scored.reply_window_expires_at,
    scored.reply_window_open,
    scored.priority_rank::integer,
    scored.conversation_mode,
    scored.conversation_state,
    scored.handoff_reason,
    scored.last_bot_action,
    scored.latest_render_metadata,
    scored.archived_at
  from scored
  where
    (coalesce(p_scope, 'inbox') <> 'outbound' or scored.has_inbound = false)
    and (coalesce(p_scope, 'inbox') = 'outbound' or scored.has_inbound = true)
    and (
      coalesce(p_business_number, 'all') = 'all'
      or scored.resolved_business_number = p_business_number
      or regexp_replace(scored.resolved_business_number, '\D', '', 'g') = regexp_replace(p_business_number, '\D', '', 'g')
    )
    and (
      coalesce(p_counsellor_filter, 'all') = 'all'
      or (p_counsellor_filter = 'unassigned' and scored.counsellor_id is null)
      or scored.counsellor_id::text = p_counsellor_filter
    )
    and (
      coalesce(p_ops_filter, 'all') = 'all'
      or (p_ops_filter = 'reply_window' and scored.priority_rank = 1)
      or (p_ops_filter = 'handoff' and (scored.handoff_reason is not null or scored.conversation_mode = 'human'))
      or (p_ops_filter = 'knowledge' and (scored.conversation_state = 'knowledge_gap' or scored.last_bot_action = 'knowledge_gap'))
      or (p_ops_filter = 'unassigned' and scored.counsellor_id is null and scored.has_inbound)
      or (p_ops_filter = 'sla' and scored.sla_due_at is not null and scored.sla_due_at < now())
      or (p_ops_filter = 'archived' and scored.archived_at is not null and (scored.last_inbound_at is null or scored.last_inbound_at <= scored.archived_at))
    )
    and (
      p_ops_filter = 'archived'
      or scored.archived_at is null
      or (scored.last_inbound_at is not null and scored.last_inbound_at > scored.archived_at)
    )
    and (
      p_cursor_at is null
      or scored.last_message_at < p_cursor_at
      or (scored.last_message_at = p_cursor_at and scored.phone < coalesce(p_cursor_phone, ''))
    )
  order by
    scored.priority_rank asc,
    case scored.lead_temperature when 'hot' then 1 when 'warm' then 2 when 'cold' then 3 else 4 end asc,
    scored.reply_window_expires_at asc nulls last,
    scored.last_message_at desc,
    scored.phone desc
  limit least(greatest(coalesce(p_limit, 120), 1), 250);
$$;

grant execute on function public.whatsapp_inbox_page(text, text, text, text, timestamptz, text, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. whatsapp_reply_state_counts — exclude archived conversations from
--    needs_reply / unread_messages / total, same hide rule. This function
--    reads whatsapp_messages directly (perf shape unchanged); its `ckey` is
--    already the canonical whatsapp_conversation_key() format, which matches
--    the mode/state rows on whatsapp_conversation_state, so we join straight
--    on (phone, ckey) — no resolved_business_number translation needed here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_reply_state_counts(
  p_counsellor_id uuid DEFAULT NULL::uuid,
  p_business_key text DEFAULT NULL::text,
  p_include_outbound_only boolean DEFAULT false
)
RETURNS TABLE(needs_reply integer, awaiting_them integer, unread_messages integer, total integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.direction,
      wm.created_at,
      wm.is_read,
      wm.lead_id
    FROM public.whatsapp_messages wm
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
  ),
  conv AS (
    SELECT
      b.phone,
      b.ckey,
      (array_agg(b.direction ORDER BY b.created_at DESC))[1] AS last_dir,
      (array_agg(b.lead_id   ORDER BY b.created_at DESC))[1] AS last_lead_id,
      bool_or(b.direction = 'inbound') AS has_inbound,
      max(b.created_at) FILTER (WHERE b.direction = 'outbound') AS last_out_at,
      max(b.created_at) FILTER (WHERE b.direction = 'inbound') AS last_in_at,
      array_agg(DISTINCT b.lead_id) FILTER (WHERE b.lead_id IS NOT NULL) AS lead_ids
    FROM base b
    GROUP BY b.phone, b.ckey
  ),
  scoped AS (
    SELECT c.phone, c.ckey, c.last_dir, c.last_out_at, l.stage::text AS last_stage
    FROM conv c
    LEFT JOIN public.leads l ON l.id = c.last_lead_id
    LEFT JOIN public.whatsapp_conversation_state cas
      ON cas.phone = c.phone AND cas.business_number = c.ckey
    WHERE (p_include_outbound_only OR c.has_inbound)
      AND (p_counsellor_id IS NULL OR EXISTS (
            SELECT 1 FROM public.leads o
            WHERE o.id = ANY(c.lead_ids) AND o.counsellor_id = p_counsellor_id))
      AND (cas.archived_at IS NULL OR (c.last_in_at IS NOT NULL AND c.last_in_at > cas.archived_at))
  ),
  unread AS (
    SELECT COALESCE(SUM(z.cnt), 0)::integer AS total_unread
    FROM (
      SELECT b.phone, b.ckey, COUNT(*) AS cnt
      FROM base b
      JOIN scoped s USING (phone, ckey)
      WHERE b.direction = 'inbound'
        AND b.is_read = false
        AND b.created_at > COALESCE(s.last_out_at, '-infinity'::timestamptz)
      GROUP BY b.phone, b.ckey
    ) z
  )
  SELECT
    COUNT(*) FILTER (WHERE s.last_dir = 'inbound' AND COALESCE(s.last_stage, '') <> 'dnc')::integer,
    COUNT(*) FILTER (WHERE s.last_dir = 'outbound')::integer,
    (SELECT total_unread FROM unread),
    COUNT(*)::integer
  FROM scoped s;
$function$;

GRANT EXECUTE ON FUNCTION public.whatsapp_reply_state_counts(uuid, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. whatsapp_inbox_category_counts — same hide rule (counts conversations
--    independently of the view, same population as whatsapp_reply_state_counts).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.whatsapp_inbox_category_counts(
  p_counsellor_id uuid DEFAULT NULL,
  p_business_key  text DEFAULT NULL
)
RETURNS TABLE (
  category        text,
  conversations   integer,
  unread_messages integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH last_msg AS (
    SELECT DISTINCT ON (wm.phone, public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number))
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.direction,
      wm.lead_id
    FROM public.whatsapp_messages wm
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
    ORDER BY wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number),
      wm.created_at DESC
  ),
  scoped AS (
    SELECT
      m.phone,
      m.ckey,
      m.lead_id,
      l.person_role AS person_role,
      EXISTS (
        SELECT 1
        FROM public.profiles pr
        JOIN public.user_roles ur ON ur.user_id = pr.user_id
        WHERE ur.role IN (
          'super_admin','campus_admin','principal','admission_head','counsellor',
          'accountant','faculty','teacher','data_entry','office_admin',
          'office_assistant','school_coordinator','hostel_warden'
        )
          AND pr.phone IS NOT NULL
          AND regexp_replace(pr.phone, '\D', '', 'g') = m.phone
      ) AS is_staff
    FROM last_msg m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    LEFT JOIN public.whatsapp_conversation_state cas
      ON cas.phone = m.phone AND cas.business_number = m.ckey
    CROSS JOIN LATERAL (
      SELECT MAX(i.created_at) AS last_inbound_at
      FROM public.whatsapp_messages i
      WHERE i.phone = m.phone
        AND i.direction = 'inbound'
        AND public.whatsapp_conversation_key(i.provider, i.business_phone_number_id, i.business_phone_number) = m.ckey
    ) li
    WHERE
      -- Inbox population: threads that have actually received an inbound.
      li.last_inbound_at IS NOT NULL
      -- Counsellor scoping mirrors whatsapp_reply_state_counts: any lead on this
      -- conversation belongs to them. NULL = admin view (no scoping).
      AND (p_counsellor_id IS NULL OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages c
        JOIN public.leads cl ON cl.id = c.lead_id
        WHERE c.phone = m.phone
          AND public.whatsapp_conversation_key(c.provider, c.business_phone_number_id, c.business_phone_number) = m.ckey
          AND cl.counsellor_id = p_counsellor_id
      ))
      -- Hide rule: archived conversations drop out unless a fresh inbound
      -- landed after the archive timestamp.
      AND (cas.archived_at IS NULL OR li.last_inbound_at > cas.archived_at)
  ),
  cats AS (
    SELECT
      s.phone,
      s.ckey,
      CASE
        WHEN s.person_role = 'job_applicant' THEN 'jobs'
        WHEN s.person_role IN ('vendor','other') THEN 'other'
        WHEN s.lead_id IS NOT NULL THEN 'admission'
        WHEN s.is_staff THEN 'staff'
        ELSE NULL
      END AS category,
      u.cnt AS unread_cnt
    FROM scoped s
    -- Same unread predicate as whatsapp_conversations.unread_count / the
    -- reply-state RPC: unread inbound with no outbound sent after it.
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM public.whatsapp_messages wm2
      WHERE wm2.phone = s.phone
        AND wm2.direction = 'inbound'
        AND wm2.is_read = false
        AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number) = s.ckey
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_messages r
          WHERE r.phone = wm2.phone
            AND r.direction = 'outbound'
            AND r.created_at > wm2.created_at
            AND public.whatsapp_conversation_key(r.provider, r.business_phone_number_id, r.business_phone_number) = s.ckey
        )
    ) u
  )
  SELECT 'all'::text AS category,
         COUNT(*)::integer AS conversations,
         COALESCE(SUM(unread_cnt), 0)::integer AS unread_messages
  FROM cats
  UNION ALL
  SELECT category,
         COUNT(*)::integer,
         COALESCE(SUM(unread_cnt), 0)::integer
  FROM cats
  WHERE category IS NOT NULL
  GROUP BY category;
$fn$;

COMMENT ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) IS
  'Population-accurate WhatsApp inbox counts per category (all/admission/staff/other/jobs), each with conversations + unread_messages. Same population and scoping as whatsapp_reply_state_counts; excludes archived conversations (whatsapp_conversation_state.archived_at) unless a fresh inbound landed after the archive timestamp.';

REVOKE ALL ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_whatsapp_conversations() / whatsapp_conversations view — this is
--    the ACTUAL source of the inbox list (src/pages/WhatsAppInbox.tsx reads
--    the view directly; whatsapp_inbox_page above is unused by the list, only
--    by header counts elsewhere). Add archived_at + archived_effective
--    (archived AND no inbound landed after archived_at) as trailing columns
--    so the frontend can filter the list client-side without touching every
--    other column mapping. Changing RETURNS TABLE requires dropping the
--    dependent view first.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.whatsapp_conversations;
DROP FUNCTION IF EXISTS public.get_whatsapp_conversations();

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations()
RETURNS TABLE (
  phone text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  lead_source text,
  counsellor_id uuid,
  counsellor_name text,
  course_name text,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  assigned_to uuid,
  provider text,
  business_phone_number_id text,
  business_phone_number text,
  conversation_mode text,
  conversation_state text,
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text,
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  unread_count integer,
  has_inbound boolean,
  lead_counsellor_ids uuid[],
  archived_at timestamp with time zone,
  archived_effective boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (
    latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  )
    latest.phone,
    latest.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.source::text AS lead_source,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    latest.content AS last_message,
    latest.direction AS last_direction,
    latest.created_at AS last_message_at,
    latest.assigned_to,
    latest.provider,
    latest.business_phone_number_id,
    latest.business_phone_number,
    COALESCE(wcs.mode, 'ai') AS conversation_mode,
    COALESCE(
      wcs.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(wcs.owner_user_id, l.counsellor_id) AS owner_user_id,
    wcs.escalation_role,
    wcs.handoff_reason,
    COALESCE(wcs.priority, 'normal') AS priority,
    wcs.sla_due_at,
    wcs.last_intent,
    wcs.last_confidence,
    wcs.last_bot_action,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids,
    wcs.archived_at,
    (
      wcs.archived_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_messages wmA
        WHERE wmA.phone = latest.phone
          AND wmA.direction = 'inbound'
          AND wmA.created_at > wcs.archived_at
          AND public.whatsapp_conversation_key(wmA.provider, wmA.business_phone_number_id, wmA.business_phone_number)
            = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      )
    ) AS archived_effective
  FROM public.whatsapp_messages latest
  LEFT JOIN public.leads l ON l.id = latest.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.whatsapp_conversation_state wcs
    ON wcs.phone = latest.phone
   AND wcs.business_number = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm2
    WHERE wm2.phone = latest.phone
      AND wm2.direction = 'inbound'
      AND wm2.is_read = false
      AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm2.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm2.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
      )
  ) unread ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm3
    WHERE wm3.phone = latest.phone
      AND wm3.direction = 'inbound'
      AND public.whatsapp_conversation_key(wm3.provider, wm3.business_phone_number_id, wm3.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  ) inbound ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = latest.phone
      AND public.whatsapp_conversation_key(wm4.provider, wm4.business_phone_number_id, wm4.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  ORDER BY latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number),
    latest.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations() TO service_role;

CREATE VIEW public.whatsapp_conversations
WITH (security_invoker = true) AS
  SELECT * FROM public.get_whatsapp_conversations();

GRANT SELECT ON public.whatsapp_conversations TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO service_role;

-- ---------------------------------------------------------------------------
-- 6. get_whatsapp_conversations_by_phones() — campaign "engaged leads" deep
--    link. Same two trailing columns, same expressions, no dependent view so
--    a straight CREATE OR REPLACE would fail on the return-type change; drop
--    first.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_whatsapp_conversations_by_phones(text[]);

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations_by_phones(_phones text[])
 RETURNS TABLE(phone text, lead_id uuid, lead_name text, lead_stage text, lead_person_role text, lead_source text, counsellor_id uuid, counsellor_name text, course_name text, last_message text, last_direction text, last_message_at timestamp with time zone, assigned_to uuid, provider text, business_phone_number_id text, business_phone_number text, conversation_mode text, conversation_state text, owner_user_id uuid, escalation_role text, handoff_reason text, priority text, sla_due_at timestamp with time zone, last_intent text, last_confidence numeric, last_bot_action text, unread_count integer, has_inbound boolean, lead_counsellor_ids uuid[], archived_at timestamp with time zone, archived_effective boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (
    latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  )
    latest.phone,
    latest.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.source::text AS lead_source,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    latest.content AS last_message,
    latest.direction AS last_direction,
    latest.created_at AS last_message_at,
    latest.assigned_to,
    latest.provider,
    latest.business_phone_number_id,
    latest.business_phone_number,
    COALESCE(wcs.mode, 'ai') AS conversation_mode,
    COALESCE(
      wcs.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(wcs.owner_user_id, l.counsellor_id) AS owner_user_id,
    wcs.escalation_role,
    wcs.handoff_reason,
    COALESCE(wcs.priority, 'normal') AS priority,
    wcs.sla_due_at,
    wcs.last_intent,
    wcs.last_confidence,
    wcs.last_bot_action,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids,
    wcs.archived_at,
    (
      wcs.archived_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_messages wmA
        WHERE wmA.phone = latest.phone
          AND wmA.direction = 'inbound'
          AND wmA.created_at > wcs.archived_at
          AND public.whatsapp_conversation_key(wmA.provider, wmA.business_phone_number_id, wmA.business_phone_number)
            = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      )
    ) AS archived_effective
  FROM public.whatsapp_messages latest
  LEFT JOIN public.leads l ON l.id = latest.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.whatsapp_conversation_state wcs
    ON wcs.phone = latest.phone
   AND wcs.business_number = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm2
    WHERE wm2.phone = latest.phone
      AND wm2.direction = 'inbound'
      AND wm2.is_read = false
      AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm2.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm2.created_at
          AND public.whatsapp_conversation_key(replied.provider, replied.business_phone_number_id, replied.business_phone_number)
            = public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number)
      )
  ) unread ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm3
    WHERE wm3.phone = latest.phone
      AND wm3.direction = 'inbound'
      AND public.whatsapp_conversation_key(wm3.provider, wm3.business_phone_number_id, wm3.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
  ) inbound ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = latest.phone
      AND public.whatsapp_conversation_key(wm4.provider, wm4.business_phone_number_id, wm4.business_phone_number)
        = public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number)
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  WHERE latest.phone = ANY(_phones)
  ORDER BY latest.phone,
    public.whatsapp_conversation_key(latest.provider, latest.business_phone_number_id, latest.business_phone_number),
    latest.created_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations_by_phones(text[]) TO authenticated;
