-- Fix: campaign engagement trigger matched woc.business_number (actual phone)
-- against NEW.business_phone_number_id (Meta ID). For Seralis (and any number
-- where the outbound context stored the actual phone rather than the Meta ID),
-- the two never matched → 0 responses attributed despite 280+ real replies.
--
-- Root cause: whatsapp-conversation-action.ts line 83 prefers
-- sendResult.businessNumber (actual phone) over sendResult.businessPhoneNumberId
-- (Meta ID) when populating woc.business_number. But the trigger only compared
-- against NEW.business_phone_number_id. Fix: match against EITHER.

CREATE OR REPLACE FUNCTION public.fn_mark_campaign_recipient_whatsapp_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context record;
  v_phone text;
  v_biz_id text;   -- Meta phone_number_id (e.g. 836776566178513)
  v_biz_num text;  -- actual phone number  (e.g. 919599931471)
  v_is_button boolean;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  v_phone := regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
  v_biz_id  := regexp_replace(COALESCE(NEW.business_phone_number_id, ''), '[^0-9]', '', 'g');
  v_biz_num := regexp_replace(COALESCE(NEW.business_phone_number, ''), '[^0-9]', '', 'g');
  v_is_button := NEW.message_type IN ('interactive', 'button');

  SELECT woc.campaign_recipient_id, woc.campaign_id
    INTO v_context
    FROM public.whatsapp_outbound_context woc
   WHERE woc.campaign_recipient_id IS NOT NULL
     AND woc.phone = v_phone
     AND woc.created_at <= COALESCE(NEW.created_at, now())
     AND (woc.expires_at IS NULL OR woc.expires_at >= COALESCE(NEW.created_at, now()))
     AND (
       -- ponytail: lenient when either side has no business number
       (v_biz_id = '' AND v_biz_num = '')
       OR COALESCE(regexp_replace(woc.business_number, '[^0-9]', '', 'g'), '') = ''
       OR regexp_replace(woc.business_number, '[^0-9]', '', 'g') IN (v_biz_id, v_biz_num)
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

-- Backfill: attribute existing unmatched replies for ALL campaigns
-- by re-running the matching logic against inbound messages
WITH unmatched_replies AS (
  SELECT
    wcr.id AS recipient_id,
    wm.id AS message_id,
    wm.created_at AS reply_at,
    wm.message_type,
    wm.content,
    ROW_NUMBER() OVER (PARTITION BY wcr.id ORDER BY wm.created_at) AS rn
  FROM whatsapp_campaign_recipients wcr
  JOIN whatsapp_outbound_context woc ON woc.campaign_recipient_id = wcr.id
  JOIN whatsapp_messages wm
    ON wm.direction = 'inbound'
   AND regexp_replace(COALESCE(wm.phone, ''), '[^0-9]', '', 'g') = woc.phone
   AND wm.created_at >= woc.created_at
   AND (woc.expires_at IS NULL OR wm.created_at <= woc.expires_at)
  WHERE wcr.responded_at IS NULL
    AND wcr.status IN ('sent', 'delivered', 'read')
)
UPDATE whatsapp_campaign_recipients wcr
   SET responded_at = ur.reply_at,
       response_message_id = ur.message_id,
       clicked_button_at = CASE WHEN ur.message_type IN ('interactive', 'button') THEN ur.reply_at ELSE wcr.clicked_button_at END,
       clicked_button_title = CASE WHEN ur.message_type IN ('interactive', 'button') THEN ur.content ELSE wcr.clicked_button_title END
  FROM unmatched_replies ur
 WHERE ur.recipient_id = wcr.id
   AND ur.rn = 1;
