-- keep-migration-version: already recorded on production schema_migrations
-- Category chips from the chat index, not DISTINCT ON every message.
--
-- whatsapp_inbox_category_counts still rebuilt the latest row per thread from
-- whatsapp_messages, then ran a per-thread unread lateral. That is the same
-- 8s timeout the list RPC used to hit. Counts can read
-- whatsapp_conversation_state (has_inbound, unreplied_count, lead_id) like
-- the list and reply-state chips already do.

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
  WITH staff_phones AS (
    SELECT DISTINCT RIGHT(regexp_replace(pr.phone, '\D', '', 'g'), 10) AS phone10
    FROM public.profiles pr
    JOIN public.user_roles ur ON ur.user_id = pr.user_id
    WHERE pr.phone IS NOT NULL
      AND length(regexp_replace(pr.phone, '\D', '', 'g')) >= 10
      AND ur.role IN (
        'super_admin','campus_admin','principal','admission_head','counsellor',
        'accountant','faculty','teacher','data_entry','office_admin',
        'office_assistant','school_coordinator','hostel_warden'
      )
  ),
  cats AS (
    SELECT
      CASE
        WHEN l.person_role = 'job_applicant' THEN 'jobs'
        WHEN l.person_role IN ('vendor','other') THEN 'other'
        WHEN s.lead_id IS NOT NULL THEN 'admission'
        WHEN sp.phone10 IS NOT NULL THEN 'staff'
        ELSE NULL
      END AS category,
      COALESCE(s.unreplied_count, 0) AS unread_cnt
    FROM public.whatsapp_conversation_state s
    LEFT JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN staff_phones sp ON sp.phone10 = RIGHT(s.phone, 10)
    WHERE s.last_message_at IS NOT NULL
      AND s.has_inbound
      AND (
        s.archived_at IS NULL
        OR (s.last_inbound_at IS NOT NULL AND s.last_inbound_at > s.archived_at)
      )
      AND (
        p_counsellor_id IS NULL
        OR l.counsellor_id = p_counsellor_id
        OR p_counsellor_id = ANY (COALESCE(s.lead_counsellor_ids, '{}'::uuid[]))
      )
      AND (
        p_business_key IS NULL
        OR (p_business_key = 'unattributed' AND s.last_business_phone_number_id IS NULL)
        OR (p_business_key <> 'unattributed' AND (
              s.last_business_phone_number_id = p_business_key
           OR s.business_number = p_business_key
           OR s.last_business_phone_number = p_business_key))
      )
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
  'Inbox category chips from whatsapp_conversation_state (chat index), not DISTINCT ON whatsapp_messages. Same population as the inbound list: has_inbound, not archived.';

-- Opening a long thread used to UPDATE every unread inbound row before the
-- thread painted. Zero the chat-index counter first (list/chips), then cap
-- the is_read backfill so a 1000-message thread cannot stall the RPC.
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

  UPDATE public.whatsapp_conversation_state s
     SET unreplied_count = 0
   WHERE s.phone = v_phone
     AND (v_key = '' OR s.business_number = v_key);

  UPDATE public.whatsapp_messages wm
     SET is_read = true,
         read_at = COALESCE(wm.read_at, now())
    FROM (
      SELECT m.id
      FROM public.whatsapp_messages m
      WHERE m.phone = v_phone
        AND m.direction = 'inbound'
        AND m.is_read = false
        AND (
          v_key = ''
          OR public.whatsapp_conversation_key(m.provider, m.business_phone_number_id, m.business_phone_number) = v_key
        )
      ORDER BY m.created_at DESC
      LIMIT 200
    ) unread
   WHERE wm.id = unread.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_whatsapp_conversation_read(text, text, text, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
