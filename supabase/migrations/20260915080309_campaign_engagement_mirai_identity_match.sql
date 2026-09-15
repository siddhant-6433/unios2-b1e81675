-- keep-migration-version
-- Already applied to production as 20260915080309. Do not restamp.
--
-- Campaign engagement for school senders (Mirai 9220522282, Beacon, Seralis):
-- outbound context stores the actual phone, inbound webhooks store Meta's
-- phone_number_id, and list phones may be 10-digit while Meta sends 91-prefixed
-- 12-digit IDs. Exact equality missed real replies, so engaged stayed empty.
--
-- Fix: expand both sides into match keys (10-digit / 91+10 / Meta ID) and
-- alias Meta IDs through whatsapp_channels. Backfill recovers missed replies.

CREATE OR REPLACE FUNCTION public.whatsapp_match_keys(value text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN d = '' THEN ARRAY[]::text[]
    WHEN length(d) = 10 THEN ARRAY[d, '91' || d]
    WHEN length(d) = 12 AND d LIKE '91%' THEN ARRAY[d, right(d, 10)]
    ELSE ARRAY[d]
  END
  FROM (SELECT regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g') AS d) s;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_business_match_keys(
  p_phone_number_id text,
  p_display_number text
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_keys text[];
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT k
      FROM unnest(
        public.whatsapp_match_keys(p_phone_number_id)
        || public.whatsapp_match_keys(p_display_number)
      ) k
     WHERE k <> ''
  ) INTO v_keys;

  IF COALESCE(array_length(v_keys, 1), 0) = 0 THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT k
      FROM (
        SELECT unnest(v_keys) AS k
        UNION
        SELECT unnest(
          public.whatsapp_match_keys(ch.business_number)
          || public.whatsapp_match_keys(ch.meta_phone_number_id)
        )
          FROM public.whatsapp_channels ch
         WHERE public.whatsapp_match_keys(ch.meta_phone_number_id) && v_keys
            OR public.whatsapp_match_keys(ch.business_number) && v_keys
      ) s
     WHERE COALESCE(s.k, '') <> ''
  ) INTO v_keys;

  RETURN COALESCE(v_keys, ARRAY[]::text[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mark_campaign_recipient_whatsapp_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context record;
  v_phone_keys text[];
  v_biz_keys text[];
  v_is_button boolean;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  v_phone_keys := public.whatsapp_match_keys(NEW.phone);
  v_biz_keys := public.whatsapp_business_match_keys(
    NEW.business_phone_number_id,
    NEW.business_phone_number
  );
  v_is_button := NEW.message_type IN ('interactive', 'button');

  SELECT woc.campaign_recipient_id, woc.campaign_id
    INTO v_context
    FROM public.whatsapp_outbound_context woc
   WHERE woc.campaign_recipient_id IS NOT NULL
     AND COALESCE(array_length(v_phone_keys, 1), 0) > 0
     AND woc.phone = ANY (v_phone_keys)
     AND woc.created_at <= COALESCE(NEW.created_at, now())
     AND (woc.expires_at IS NULL OR woc.expires_at >= COALESCE(NEW.created_at, now()))
     AND (
       COALESCE(array_length(v_biz_keys, 1), 0) = 0
       OR COALESCE(regexp_replace(woc.business_number, '[^0-9]', '', 'g'), '') = ''
       OR regexp_replace(woc.business_number, '[^0-9]', '', 'g') = ANY (v_biz_keys)
     )
   ORDER BY woc.created_at DESC
   LIMIT 1;

  IF v_context.campaign_recipient_id IS NOT NULL THEN
    UPDATE public.whatsapp_campaign_recipients
       SET responded_at = COALESCE(responded_at, NEW.created_at, now()),
           response_message_id = COALESCE(response_message_id, NEW.id),
           clicked_button_at = CASE WHEN v_is_button THEN COALESCE(clicked_button_at, NEW.created_at, now()) ELSE clicked_button_at END,
           clicked_button_title = CASE WHEN v_is_button THEN COALESCE(clicked_button_title, NEW.content) ELSE clicked_button_title END,
           clicked_button_payload = CASE WHEN v_is_button THEN COALESCE(clicked_button_payload, NEW.content) ELSE clicked_button_payload END
     WHERE id = v_context.campaign_recipient_id;
  END IF;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.whatsapp_match_keys(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_business_match_keys(text, text) TO authenticated, service_role;

-- Backfill via indexed phone equality, not regexp on every inbound row.
-- Disable the per-row campaign count trigger so 1k+ updates don't each recount.
ALTER TABLE public.whatsapp_campaign_recipients
  DISABLE TRIGGER trg_refresh_whatsapp_campaign_engagement_counts;

WITH channel_alias AS (
  SELECT DISTINCT ident AS inbound_ident, sibling AS woc_ident
    FROM public.whatsapp_channels ch
    CROSS JOIN LATERAL unnest(
      public.whatsapp_match_keys(ch.business_number)
      || public.whatsapp_match_keys(ch.meta_phone_number_id)
    ) AS ident
    CROSS JOIN LATERAL unnest(
      public.whatsapp_match_keys(ch.business_number)
      || public.whatsapp_match_keys(ch.meta_phone_number_id)
    ) AS sibling
   WHERE ident <> '' AND sibling <> ''
),
ctx AS (
  SELECT
    wcr.id AS recipient_id,
    wcr.campaign_id,
    woc.created_at,
    woc.expires_at,
    regexp_replace(COALESCE(woc.business_number, ''), '[^0-9]', '', 'g') AS woc_biz,
    phone_key
  FROM public.whatsapp_campaign_recipients wcr
  JOIN public.whatsapp_outbound_context woc
    ON woc.campaign_recipient_id = wcr.id
  CROSS JOIN LATERAL unnest(
    public.whatsapp_match_keys(woc.phone)
    || ARRAY(
         SELECT '+' || k
           FROM unnest(public.whatsapp_match_keys(woc.phone)) k
          WHERE k <> ''
       )
  ) AS phone_key
  WHERE wcr.responded_at IS NULL
    AND wcr.status IN ('sent', 'delivered', 'read')
    AND phone_key <> ''
),
matched AS (
  SELECT DISTINCT ON (ctx.recipient_id)
    ctx.recipient_id,
    ctx.campaign_id,
    wm.id AS message_id,
    wm.created_at AS reply_at,
    wm.message_type,
    wm.content
  FROM ctx
  JOIN public.whatsapp_messages wm
    ON wm.direction = 'inbound'
   AND wm.phone = ctx.phone_key
   AND wm.created_at >= ctx.created_at
   AND (ctx.expires_at IS NULL OR wm.created_at <= ctx.expires_at)
  WHERE ctx.woc_biz = ''
     OR (
       COALESCE(regexp_replace(wm.business_phone_number_id, '[^0-9]', '', 'g'), '') = ''
       AND COALESCE(regexp_replace(wm.business_phone_number, '[^0-9]', '', 'g'), '') = ''
     )
     OR ctx.woc_biz = ANY (
          public.whatsapp_match_keys(wm.business_phone_number_id)
          || public.whatsapp_match_keys(wm.business_phone_number)
        )
     OR EXISTS (
          SELECT 1
            FROM channel_alias a
           WHERE a.woc_ident = ctx.woc_biz
             AND a.inbound_ident = ANY (
                   public.whatsapp_match_keys(wm.business_phone_number_id)
                   || public.whatsapp_match_keys(wm.business_phone_number)
                 )
        )
  ORDER BY ctx.recipient_id, wm.created_at
),
updated AS (
  UPDATE public.whatsapp_campaign_recipients wcr
     SET responded_at = m.reply_at,
         response_message_id = m.message_id,
         clicked_button_at = CASE WHEN m.message_type IN ('interactive', 'button') THEN m.reply_at ELSE wcr.clicked_button_at END,
         clicked_button_title = CASE WHEN m.message_type IN ('interactive', 'button') THEN m.content ELSE wcr.clicked_button_title END
    FROM matched m
   WHERE wcr.id = m.recipient_id
  RETURNING wcr.campaign_id
)
SELECT public.refresh_whatsapp_campaign_engagement_counts(id)
  FROM (SELECT DISTINCT campaign_id AS id FROM updated) s;

ALTER TABLE public.whatsapp_campaign_recipients
  ENABLE TRIGGER trg_refresh_whatsapp_campaign_engagement_counts;
