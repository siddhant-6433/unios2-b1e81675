-- Paginated WhatsApp inbox list that stays under the 8s statement timeout.
--
-- src/pages/WhatsAppInbox.tsx used to SELECT from the whatsapp_conversations
-- view. That view wraps get_whatsapp_conversations(), which DISTINCT ONs every
-- thread (41k+) and then runs four LATERAL scans per thread before PostgREST's
-- .eq/.limit can apply — ~9.5s, so the inbox toast was
-- "canceling statement due to statement timeout". Counts already avoid this
-- (whatsapp_reply_state_counts reads whatsapp_messages directly). The list
-- needs the same treatment: filter + LIMIT inside the function, then compute
-- unread / inbound / counsellor-ids only for the returned page.

CREATE INDEX IF NOT EXISTS idx_wa_messages_pnid_created
  ON public.whatsapp_messages (business_phone_number_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.whatsapp_conversations_page(
  p_last_direction text DEFAULT NULL,
  p_business_keys text[] DEFAULT NULL,
  p_unattributed_only boolean DEFAULT false,
  p_counsellor_id uuid DEFAULT NULL,
  p_counsellor_scope text DEFAULT 'all',
  p_archived boolean DEFAULT false,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_phone text DEFAULT NULL,
  p_limit integer DEFAULT 120
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
  WITH latest AS (
    SELECT DISTINCT ON (
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number)
    )
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.lead_id,
      wm.content,
      wm.direction,
      wm.created_at,
      wm.assigned_to,
      wm.provider,
      wm.business_phone_number_id,
      wm.business_phone_number
    FROM public.whatsapp_messages wm
    WHERE
      CASE
        WHEN COALESCE(p_unattributed_only, false) THEN wm.business_phone_number_id IS NULL
        WHEN p_business_keys IS NULL OR cardinality(p_business_keys) = 0 THEN true
        ELSE wm.business_phone_number_id = ANY (p_business_keys)
          OR wm.business_phone_number = ANY (p_business_keys)
      END
    ORDER BY
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number),
      wm.created_at DESC
  ),
  joined AS (
    SELECT
      latest.phone,
      latest.ckey,
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
      wcs.archived_at,
      (
        wcs.archived_at IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM public.whatsapp_messages wm_arch
          WHERE wm_arch.phone = latest.phone
            AND wm_arch.direction = 'inbound'
            AND wm_arch.created_at > wcs.archived_at
            AND public.whatsapp_conversation_key(
              wm_arch.provider, wm_arch.business_phone_number_id, wm_arch.business_phone_number
            ) = latest.ckey
        )
      ) AS archived_effective
    FROM latest
    LEFT JOIN public.leads l ON l.id = latest.lead_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.whatsapp_conversation_state wcs
      ON wcs.phone = latest.phone
     AND wcs.business_number = latest.ckey
    WHERE (p_last_direction IS NULL OR latest.direction = p_last_direction)
      AND (
        CASE
          WHEN COALESCE(p_archived, false) THEN
            wcs.archived_at IS NOT NULL AND NOT EXISTS (
              SELECT 1
              FROM public.whatsapp_messages wm_arch
              WHERE wm_arch.phone = latest.phone
                AND wm_arch.direction = 'inbound'
                AND wm_arch.created_at > wcs.archived_at
                AND public.whatsapp_conversation_key(
                  wm_arch.provider, wm_arch.business_phone_number_id, wm_arch.business_phone_number
                ) = latest.ckey
            )
          ELSE
            wcs.archived_at IS NULL OR EXISTS (
              SELECT 1
              FROM public.whatsapp_messages wm_arch
              WHERE wm_arch.phone = latest.phone
                AND wm_arch.direction = 'inbound'
                AND wm_arch.created_at > wcs.archived_at
                AND public.whatsapp_conversation_key(
                  wm_arch.provider, wm_arch.business_phone_number_id, wm_arch.business_phone_number
                ) = latest.ckey
            )
        END
      )
      AND (
        COALESCE(p_counsellor_scope, 'all') = 'all'
        OR (p_counsellor_scope = 'unassigned' AND l.counsellor_id IS NULL)
        OR (p_counsellor_scope = 'latest' AND l.counsellor_id = p_counsellor_id)
        OR (p_counsellor_scope = 'any' AND p_counsellor_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.whatsapp_messages wm_cc
          JOIN public.leads l_cc ON l_cc.id = wm_cc.lead_id
          WHERE wm_cc.phone = latest.phone
            AND public.whatsapp_conversation_key(
              wm_cc.provider, wm_cc.business_phone_number_id, wm_cc.business_phone_number
            ) = latest.ckey
            AND l_cc.counsellor_id = p_counsellor_id
        ))
      )
      AND (
        p_cursor_at IS NULL
        OR latest.created_at < p_cursor_at
        OR (latest.created_at = p_cursor_at AND latest.phone < COALESCE(p_cursor_phone, ''))
      )
  ),
  page AS (
    SELECT *
    FROM joined
    ORDER BY last_message_at DESC, phone DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 120), 1), 250)
  )
  SELECT
    page.phone,
    page.lead_id,
    page.lead_name,
    page.lead_stage,
    page.lead_person_role,
    page.lead_source,
    page.counsellor_id,
    page.counsellor_name,
    page.course_name,
    page.last_message,
    page.last_direction,
    page.last_message_at,
    page.assigned_to,
    page.provider,
    page.business_phone_number_id,
    page.business_phone_number,
    page.conversation_mode,
    page.conversation_state,
    page.owner_user_id,
    page.escalation_role,
    page.handoff_reason,
    page.priority,
    page.sla_due_at,
    page.last_intent,
    page.last_confidence,
    page.last_bot_action,
    COALESCE(unread.cnt, 0)::integer AS unread_count,
    COALESCE(inbound.cnt, 0)::integer > 0 AS has_inbound,
    COALESCE(cc.ids, ARRAY[]::uuid[]) AS lead_counsellor_ids,
    page.archived_at,
    page.archived_effective
  FROM page
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm2
    WHERE wm2.phone = page.phone
      AND wm2.direction = 'inbound'
      AND wm2.is_read = false
      AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number) = page.ckey
      AND NOT EXISTS (
        SELECT 1
        FROM public.whatsapp_messages replied
        WHERE replied.phone = wm2.phone
          AND replied.direction = 'outbound'
          AND replied.created_at > wm2.created_at
          AND public.whatsapp_conversation_key(
            replied.provider, replied.business_phone_number_id, replied.business_phone_number
          ) = page.ckey
      )
  ) unread ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.whatsapp_messages wm3
    WHERE wm3.phone = page.phone
      AND wm3.direction = 'inbound'
      AND public.whatsapp_conversation_key(wm3.provider, wm3.business_phone_number_id, wm3.business_phone_number) = page.ckey
  ) inbound ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT l2.counsellor_id) AS ids
    FROM public.whatsapp_messages wm4
    JOIN public.leads l2 ON l2.id = wm4.lead_id
    WHERE wm4.phone = page.phone
      AND public.whatsapp_conversation_key(wm4.provider, wm4.business_phone_number_id, wm4.business_phone_number) = page.ckey
      AND l2.counsellor_id IS NOT NULL
  ) cc ON true
  ORDER BY page.last_message_at DESC, page.phone DESC;
$$;

COMMENT ON FUNCTION public.whatsapp_conversations_page(text, text[], boolean, uuid, text, boolean, timestamptz, text, integer) IS
  'Inbox list page: latest-message DISTINCT ON, then filter/LIMIT, then unread laterals only for the returned rows. Replaces SELECT FROM whatsapp_conversations which timed out at 41k conversations.';

GRANT EXECUTE ON FUNCTION public.whatsapp_conversations_page(text, text[], boolean, uuid, text, boolean, timestamptz, text, integer)
  TO authenticated, service_role;
