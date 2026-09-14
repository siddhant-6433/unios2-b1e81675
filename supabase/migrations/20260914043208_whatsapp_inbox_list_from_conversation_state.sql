-- keep-migration-version: already recorded on production schema_migrations
-- Inbox list as a chat index (WhatsApp Web model), not a DISTINCT ON of every
-- whatsapp_messages row.
--
-- whatsapp_conversations_page still rebuilt the latest message per thread on
-- every inbox paint. At ~41k conversations that DISTINCT ON + laterals is the
-- 8s statement-timeout path. Counts already read whatsapp_conversation_state
-- (last_direction / last_message_at maintained on INSERT). The list needs the
-- same treatment: filter + LIMIT on the ~41k-row index, then join leads.

ALTER TABLE public.whatsapp_conversation_state
  ADD COLUMN IF NOT EXISTS last_message text,
  ADD COLUMN IF NOT EXISTS last_assigned_to uuid,
  ADD COLUMN IF NOT EXISTS last_business_phone_number text,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS unreplied_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_counsellor_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.whatsapp_conversation_state.last_message IS
  'Preview of the latest whatsapp_messages.content for this phone+channel. Source for the inbox list.';
COMMENT ON COLUMN public.whatsapp_conversation_state.unreplied_count IS
  'Inbound messages since the last outbound (approx.). Zeroed on outbound insert and mark_whatsapp_conversation_read.';

CREATE INDEX IF NOT EXISTS idx_wcs_list_last_message
  ON public.whatsapp_conversation_state (last_message_at DESC, phone DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcs_list_pnid_last_message
  ON public.whatsapp_conversation_state (last_business_phone_number_id, last_message_at DESC, phone DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcs_list_direction_last_message
  ON public.whatsapp_conversation_state (last_direction, last_message_at DESC, phone DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcs_list_unattributed
  ON public.whatsapp_conversation_state (last_message_at DESC, phone DESC)
  WHERE last_business_phone_number_id IS NULL AND last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wcs_list_has_inbound
  ON public.whatsapp_conversation_state (last_message_at DESC, phone DESC)
  WHERE last_message_at IS NOT NULL AND has_inbound;

CREATE INDEX IF NOT EXISTS idx_wcs_lead_counsellor_ids
  ON public.whatsapp_conversation_state USING gin (lead_counsellor_ids);

-- Open-thread pages are phone + created_at DESC LIMIT n (newest window, then
-- scroll-up). The existing phone-only index still sorts; this one is the lookup.
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone_created_at
  ON public.whatsapp_messages (phone, created_at DESC);

CREATE OR REPLACE FUNCTION public.trg_whatsapp_messages_touch_conversation_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $tg$
DECLARE
  v_key text;
  v_provider text;
  v_counsellor uuid;
  v_preview text;
BEGIN
  v_key := public.whatsapp_conversation_key(
    NEW.provider, NEW.business_phone_number_id, NEW.business_phone_number);
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'unattributed';
  END IF;
  IF NEW.direction IS DISTINCT FROM 'inbound' AND NEW.direction IS DISTINCT FROM 'outbound' THEN
    RETURN NEW;
  END IF;
  v_provider := CASE WHEN NEW.provider IN ('meta', 'plivo') THEN NEW.provider ELSE 'meta' END;
  v_preview := left(COALESCE(NEW.content, ''), 500);

  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.counsellor_id INTO v_counsellor
    FROM public.leads l
    WHERE l.id = NEW.lead_id;
  END IF;

  INSERT INTO public.whatsapp_conversation_state (
    phone,
    business_number,
    provider,
    lead_id,
    last_direction,
    last_message_at,
    last_message,
    last_assigned_to,
    has_inbound,
    last_business_phone_number_id,
    last_business_phone_number,
    last_inbound_at,
    last_outbound_at,
    unreplied_count,
    lead_counsellor_ids,
    updated_at
  ) VALUES (
    NEW.phone,
    v_key,
    v_provider,
    NEW.lead_id,
    NEW.direction,
    NEW.created_at,
    v_preview,
    NEW.assigned_to,
    (NEW.direction = 'inbound'),
    NEW.business_phone_number_id,
    NEW.business_phone_number,
    CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at ELSE NULL END,
    CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at ELSE NULL END,
    CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END,
    CASE WHEN v_counsellor IS NOT NULL THEN ARRAY[v_counsellor] ELSE '{}'::uuid[] END,
    now()
  )
  ON CONFLICT (phone, business_number) DO UPDATE SET
    has_inbound = public.whatsapp_conversation_state.has_inbound
      OR EXCLUDED.has_inbound,
    last_direction = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_direction
      ELSE public.whatsapp_conversation_state.last_direction
    END,
    last_message_at = GREATEST(
      public.whatsapp_conversation_state.last_message_at, EXCLUDED.last_message_at),
    last_message = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_message
      ELSE public.whatsapp_conversation_state.last_message
    END,
    last_assigned_to = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_assigned_to
      ELSE public.whatsapp_conversation_state.last_assigned_to
    END,
    lead_id = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN COALESCE(EXCLUDED.lead_id, public.whatsapp_conversation_state.lead_id)
      ELSE public.whatsapp_conversation_state.lead_id
    END,
    last_business_phone_number_id = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_business_phone_number_id
      ELSE public.whatsapp_conversation_state.last_business_phone_number_id
    END,
    last_business_phone_number = CASE
      WHEN EXCLUDED.last_message_at >= COALESCE(
        public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
      THEN EXCLUDED.last_business_phone_number
      ELSE public.whatsapp_conversation_state.last_business_phone_number
    END,
    last_inbound_at = CASE
      WHEN NEW.direction = 'inbound' THEN GREATEST(
        COALESCE(public.whatsapp_conversation_state.last_inbound_at, '-infinity'::timestamptz),
        NEW.created_at)
      ELSE public.whatsapp_conversation_state.last_inbound_at
    END,
    last_outbound_at = CASE
      WHEN NEW.direction = 'outbound' THEN GREATEST(
        COALESCE(public.whatsapp_conversation_state.last_outbound_at, '-infinity'::timestamptz),
        NEW.created_at)
      ELSE public.whatsapp_conversation_state.last_outbound_at
    END,
    unreplied_count = CASE
      WHEN NEW.direction = 'outbound'
        AND NEW.created_at >= COALESCE(
          public.whatsapp_conversation_state.last_message_at, '-infinity'::timestamptz)
        THEN 0
      WHEN NEW.direction = 'inbound'
        AND NEW.created_at >= COALESCE(
          public.whatsapp_conversation_state.last_outbound_at, '-infinity'::timestamptz)
        THEN COALESCE(public.whatsapp_conversation_state.unreplied_count, 0) + 1
      ELSE COALESCE(public.whatsapp_conversation_state.unreplied_count, 0)
    END,
    lead_counsellor_ids = (
      SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
      FROM unnest(
        COALESCE(public.whatsapp_conversation_state.lead_counsellor_ids, '{}'::uuid[])
        || COALESCE(EXCLUDED.lead_counsellor_ids, '{}'::uuid[])
      ) AS x
      WHERE x IS NOT NULL
    ),
    provider = EXCLUDED.provider,
    updated_at = now();

  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_whatsapp_messages_touch_conversation_state
  ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_touch_conversation_state
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_whatsapp_messages_touch_conversation_state();

-- Preview / counsellor ids / unreplied from the already-backfilled index.
-- last_message_at + last_direction already landed in whatsapp_pending_reply_status.
SET LOCAL statement_timeout = '10min';

-- last_message_at is already backfilled (whatsapp_pending_reply_status). Join
-- the matching message for preview text instead of DISTINCT ON every row.
UPDATE public.whatsapp_conversation_state s
SET
  last_message = left(COALESCE(wm.content, ''), 500),
  last_assigned_to = wm.assigned_to,
  last_business_phone_number = wm.business_phone_number,
  last_inbound_at = CASE
    WHEN s.last_direction = 'inbound' THEN COALESCE(s.last_inbound_at, s.last_message_at)
    ELSE s.last_inbound_at
  END,
  last_outbound_at = CASE
    WHEN s.last_direction = 'outbound' THEN COALESCE(s.last_outbound_at, s.last_message_at)
    ELSE s.last_outbound_at
  END,
  unreplied_count = CASE
    WHEN s.last_direction = 'inbound' THEN GREATEST(s.unreplied_count, 1)
    ELSE 0
  END
FROM public.whatsapp_messages wm
WHERE wm.phone = s.phone
  AND s.last_message_at IS NOT NULL
  AND wm.created_at = s.last_message_at
  AND (
    public.whatsapp_conversation_key(
      wm.provider, wm.business_phone_number_id, wm.business_phone_number
    ) = s.business_number
    OR (
      s.business_number = 'unattributed'
      AND public.whatsapp_conversation_key(
        wm.provider, wm.business_phone_number_id, wm.business_phone_number
      ) = ''
    )
  );

-- Archived filter is last_inbound_at vs archived_at. Outbound-last threads
-- would otherwise keep last_inbound_at NULL and stay archived after a later
-- inbound+outbound cycle.
UPDATE public.whatsapp_conversation_state s
SET last_inbound_at = (
  SELECT MAX(wm.created_at)
  FROM public.whatsapp_messages wm
  WHERE wm.phone = s.phone
    AND wm.direction = 'inbound'
    AND COALESCE(
      NULLIF(
        public.whatsapp_conversation_key(
          wm.provider, wm.business_phone_number_id, wm.business_phone_number
        ),
        ''
      ),
      'unattributed'
    ) = s.business_number
)
WHERE s.archived_at IS NOT NULL;

-- Threads whose conversation_key was empty were skipped by the old trigger.
INSERT INTO public.whatsapp_conversation_state (
  phone,
  business_number,
  provider,
  lead_id,
  last_direction,
  last_message_at,
  last_message,
  last_assigned_to,
  has_inbound,
  last_business_phone_number_id,
  last_business_phone_number,
  last_inbound_at,
  last_outbound_at,
  unreplied_count,
  updated_at
)
SELECT
  last.phone,
  'unattributed',
  CASE WHEN last.provider IN ('meta', 'plivo') THEN last.provider ELSE 'meta' END,
  last.lead_id,
  last.direction,
  last.created_at,
  left(COALESCE(last.content, ''), 500),
  last.assigned_to,
  last.direction = 'inbound',
  last.business_phone_number_id,
  last.business_phone_number,
  CASE WHEN last.direction = 'inbound' THEN last.created_at ELSE NULL END,
  CASE WHEN last.direction = 'outbound' THEN last.created_at ELSE NULL END,
  CASE WHEN last.direction = 'inbound' THEN 1 ELSE 0 END,
  now()
FROM (
  SELECT DISTINCT ON (wm.phone)
    wm.phone,
    wm.provider,
    wm.lead_id,
    wm.direction,
    wm.created_at,
    wm.content,
    wm.assigned_to,
    wm.business_phone_number_id,
    wm.business_phone_number
  FROM public.whatsapp_messages wm
  WHERE public.whatsapp_conversation_key(
          wm.provider, wm.business_phone_number_id, wm.business_phone_number) = ''
  ORDER BY wm.phone, wm.created_at DESC
) last
ON CONFLICT (phone, business_number) DO UPDATE SET
  last_direction = EXCLUDED.last_direction,
  last_message_at = EXCLUDED.last_message_at,
  last_message = EXCLUDED.last_message,
  last_assigned_to = EXCLUDED.last_assigned_to,
  has_inbound = public.whatsapp_conversation_state.has_inbound OR EXCLUDED.has_inbound,
  last_business_phone_number_id = COALESCE(
    public.whatsapp_conversation_state.last_business_phone_number_id,
    EXCLUDED.last_business_phone_number_id),
  last_business_phone_number = COALESCE(
    public.whatsapp_conversation_state.last_business_phone_number,
    EXCLUDED.last_business_phone_number),
  last_inbound_at = COALESCE(
    public.whatsapp_conversation_state.last_inbound_at, EXCLUDED.last_inbound_at),
  last_outbound_at = COALESCE(
    public.whatsapp_conversation_state.last_outbound_at, EXCLUDED.last_outbound_at),
  unreplied_count = GREATEST(
    public.whatsapp_conversation_state.unreplied_count, EXCLUDED.unreplied_count);

UPDATE public.whatsapp_conversation_state s
SET lead_counsellor_ids = x.ids
FROM (
  SELECT
    wm.phone,
    NULLIF(public.whatsapp_conversation_key(
      wm.provider, wm.business_phone_number_id, wm.business_phone_number), '') AS ckey,
    array_agg(DISTINCT l.counsellor_id) AS ids
  FROM public.whatsapp_messages wm
  JOIN public.leads l ON l.id = wm.lead_id
  WHERE l.counsellor_id IS NOT NULL
  GROUP BY 1, 2
) x
WHERE s.phone = x.phone
  AND s.business_number = COALESCE(x.ckey, 'unattributed')
  AND (s.lead_counsellor_ids IS NULL OR s.lead_counsellor_ids = '{}'::uuid[]);

-- Current lead assignment must be present even if no historical message-lead
-- rows were grouped above (reassigned after last message).
UPDATE public.whatsapp_conversation_state s
SET lead_counsellor_ids = (
  SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[])
  FROM unnest(
    COALESCE(s.lead_counsellor_ids, '{}'::uuid[])
    || ARRAY[l.counsellor_id]
  ) AS x
  WHERE x IS NOT NULL
)
FROM public.leads l
WHERE l.id = s.lead_id
  AND l.counsellor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_whatsapp_conversation_read(
  p_phone text,
  p_provider text DEFAULT NULL,
  p_business_phone_number_id text DEFAULT NULL,
  p_business_phone_number text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_provider text := CASE WHEN p_provider IN ('meta', 'plivo') THEN p_provider ELSE NULL END;
  v_key text := public.whatsapp_conversation_key(v_provider, p_business_phone_number_id, p_business_phone_number);
  v_count integer := 0;
BEGIN
  IF v_phone = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.whatsapp_messages wm
     SET is_read = true,
         read_at = COALESCE(wm.read_at, now())
   WHERE wm.phone = v_phone
     AND wm.direction = 'inbound'
     AND wm.is_read = false
     AND (
       v_key = ''
       OR public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) = v_key
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.whatsapp_conversation_state s
     SET unreplied_count = 0
   WHERE s.phone = v_phone
     AND (v_key = '' OR s.business_number = v_key);

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_whatsapp_conversation_read(text, text, text, text)
  TO authenticated, service_role;

-- Inbox list page: conversation_state is the chat index. No DISTINCT ON messages.
-- Extra p_has_inbound vs the 9-arg page function; drop the old signature so
-- PostgREST does not see an overload.
DROP FUNCTION IF EXISTS public.whatsapp_conversations_page(text, text[], boolean, uuid, text, boolean, timestamptz, text, integer);

CREATE OR REPLACE FUNCTION public.whatsapp_conversations_page(
  p_last_direction text DEFAULT NULL,
  p_business_keys text[] DEFAULT NULL,
  p_unattributed_only boolean DEFAULT false,
  p_counsellor_id uuid DEFAULT NULL,
  p_counsellor_scope text DEFAULT 'all',
  p_archived boolean DEFAULT false,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_phone text DEFAULT NULL,
  p_limit integer DEFAULT 120,
  p_has_inbound boolean DEFAULT NULL
)
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
  SELECT
    s.phone,
    s.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.source::text AS lead_source,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    s.last_message,
    s.last_direction,
    s.last_message_at,
    s.last_assigned_to AS assigned_to,
    s.provider,
    s.last_business_phone_number_id AS business_phone_number_id,
    COALESCE(s.last_business_phone_number, CASE WHEN s.provider = 'plivo' THEN s.business_number ELSE NULL END) AS business_phone_number,
    COALESCE(s.mode, 'ai') AS conversation_mode,
    COALESCE(
      s.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(s.owner_user_id, l.counsellor_id) AS owner_user_id,
    s.escalation_role,
    s.handoff_reason,
    COALESCE(s.priority, 'normal') AS priority,
    s.sla_due_at,
    s.last_intent,
    s.last_confidence,
    s.last_bot_action,
    COALESCE(s.unreplied_count, 0)::integer AS unread_count,
    s.has_inbound,
    COALESCE(s.lead_counsellor_ids, ARRAY[]::uuid[]) AS lead_counsellor_ids,
    s.archived_at,
    (
      s.archived_at IS NOT NULL
      AND (s.last_inbound_at IS NULL OR s.last_inbound_at <= s.archived_at)
    ) AS archived_effective
  FROM public.whatsapp_conversation_state s
  LEFT JOIN public.leads l ON l.id = s.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  WHERE s.last_message_at IS NOT NULL
    AND (p_last_direction IS NULL OR s.last_direction = p_last_direction)
    AND (
      CASE
        WHEN COALESCE(p_unattributed_only, false) THEN s.last_business_phone_number_id IS NULL
        WHEN p_business_keys IS NULL OR cardinality(p_business_keys) = 0 THEN true
        ELSE s.last_business_phone_number_id = ANY (p_business_keys)
          OR s.business_number = ANY (p_business_keys)
          OR s.last_business_phone_number = ANY (p_business_keys)
      END
    )
    AND (
      CASE
        WHEN COALESCE(p_archived, false) THEN
          s.archived_at IS NOT NULL
          AND (s.last_inbound_at IS NULL OR s.last_inbound_at <= s.archived_at)
        ELSE
          s.archived_at IS NULL
          OR (s.last_inbound_at IS NOT NULL AND s.last_inbound_at > s.archived_at)
      END
    )
    AND (
      COALESCE(p_counsellor_scope, 'all') = 'all'
      OR (p_counsellor_scope = 'unassigned' AND l.counsellor_id IS NULL)
      OR (p_counsellor_scope = 'latest' AND l.counsellor_id = p_counsellor_id)
      OR (p_counsellor_scope = 'any' AND p_counsellor_id IS NOT NULL AND (
            l.counsellor_id = p_counsellor_id
            OR p_counsellor_id = ANY (COALESCE(s.lead_counsellor_ids, '{}'::uuid[]))
          ))
    )
    AND (
      p_cursor_at IS NULL
      OR s.last_message_at < p_cursor_at
      OR (s.last_message_at = p_cursor_at AND s.phone < COALESCE(p_cursor_phone, ''))
    )
    AND (p_has_inbound IS NULL OR s.has_inbound = p_has_inbound)
  ORDER BY s.last_message_at DESC, s.phone DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 120), 1), 250);
$$;

COMMENT ON FUNCTION public.whatsapp_conversations_page(text, text[], boolean, uuid, text, boolean, timestamptz, text, integer, boolean) IS
  'Inbox list page from whatsapp_conversation_state (chat index), not DISTINCT ON whatsapp_messages. Filter + LIMIT, then join leads.';

GRANT EXECUTE ON FUNCTION public.whatsapp_conversations_page(text, text[], boolean, uuid, text, boolean, timestamptz, text, integer, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversations_by_phones(_phones text[])
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
  last_message_at timestamp with time zone,
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
  sla_due_at timestamp with time zone,
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
SET search_path TO public
AS $$
  SELECT
    s.phone,
    s.lead_id,
    l.name AS lead_name,
    l.stage::text AS lead_stage,
    l.person_role AS lead_person_role,
    l.source::text AS lead_source,
    l.counsellor_id,
    p.display_name AS counsellor_name,
    c.name AS course_name,
    s.last_message,
    s.last_direction,
    s.last_message_at,
    s.last_assigned_to AS assigned_to,
    s.provider,
    s.last_business_phone_number_id AS business_phone_number_id,
    COALESCE(s.last_business_phone_number, CASE WHEN s.provider = 'plivo' THEN s.business_number ELSE NULL END) AS business_phone_number,
    COALESCE(s.mode, 'ai') AS conversation_mode,
    COALESCE(
      s.state,
      CASE
        WHEN l.stage = 'dnc' THEN 'dnc'
        WHEN l.stage = 'not_interested' THEN 'not_interested'
        ELSE 'new_unqualified'
      END
    ) AS conversation_state,
    COALESCE(s.owner_user_id, l.counsellor_id) AS owner_user_id,
    s.escalation_role,
    s.handoff_reason,
    COALESCE(s.priority, 'normal') AS priority,
    s.sla_due_at,
    s.last_intent,
    s.last_confidence,
    s.last_bot_action,
    COALESCE(s.unreplied_count, 0)::integer AS unread_count,
    s.has_inbound,
    COALESCE(s.lead_counsellor_ids, ARRAY[]::uuid[]) AS lead_counsellor_ids,
    s.archived_at,
    (
      s.archived_at IS NOT NULL
      AND (s.last_inbound_at IS NULL OR s.last_inbound_at <= s.archived_at)
    ) AS archived_effective
  FROM public.whatsapp_conversation_state s
  LEFT JOIN public.leads l ON l.id = s.lead_id
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  WHERE s.last_message_at IS NOT NULL
    AND s.phone = ANY (_phones)
  ORDER BY s.last_message_at DESC, s.phone DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversations_by_phones(text[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_inbox_channel_keys()
RETURNS TABLE (
  business_phone_number_id text,
  business_phone_number text,
  n integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.last_business_phone_number_id,
    MAX(s.last_business_phone_number) AS business_phone_number,
    COUNT(*)::integer AS n
  FROM public.whatsapp_conversation_state s
  WHERE s.last_message_at IS NOT NULL
    AND (
      s.last_business_phone_number_id IS NOT NULL
      OR NULLIF(s.last_business_phone_number, '') IS NOT NULL
    )
  GROUP BY s.last_business_phone_number_id;
$$;

COMMENT ON FUNCTION public.whatsapp_inbox_channel_keys() IS
  'Distinct inbox channel keys from the conversation index. Replaces scanning 5000 whatsapp_messages rows on inbox mount.';

GRANT EXECUTE ON FUNCTION public.whatsapp_inbox_channel_keys()
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
