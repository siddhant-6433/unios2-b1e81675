-- Campaign engagement reporting: responses, calls, link clicks, and button clicks.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS response_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS called_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_click_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS button_click_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS response_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS called_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_click_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS button_click_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clicked_link_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_url text,
  ADD COLUMN IF NOT EXISTS clicked_button_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_button_payload text,
  ADD COLUMN IF NOT EXISTS clicked_button_title text,
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_disposition text,
  ADD COLUMN IF NOT EXISTS call_notes text,
  ADD COLUMN IF NOT EXISTS call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL;

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_link_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_url text,
  ADD COLUMN IF NOT EXISTS clicked_button_at timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_button_payload text,
  ADD COLUMN IF NOT EXISTS clicked_button_title text,
  ADD COLUMN IF NOT EXISTS called_at timestamptz,
  ADD COLUMN IF NOT EXISTS call_disposition text,
  ADD COLUMN IF NOT EXISTS call_notes text,
  ADD COLUMN IF NOT EXISTS call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients_engagement
  ON public.whatsapp_campaign_recipients (campaign_id, responded_at, called_at, clicked_link_at, clicked_button_at);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_engagement
  ON public.email_campaign_recipients (campaign_id, responded_at, called_at, clicked_link_at, clicked_button_at);

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_called_for_campaigns
  ON public.call_logs (lead_id, called_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_whatsapp_campaign_engagement_counts(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _campaign_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.whatsapp_campaigns c
     SET response_count = COALESCE(s.response_count, 0),
         called_count = COALESCE(s.called_count, 0),
         link_click_count = COALESCE(s.link_click_count, 0),
         button_click_count = COALESCE(s.button_click_count, 0)
    FROM (
      SELECT campaign_id,
             COUNT(*) FILTER (WHERE responded_at IS NOT NULL)::integer AS response_count,
             COUNT(*) FILTER (WHERE called_at IS NOT NULL)::integer AS called_count,
             COUNT(*) FILTER (WHERE clicked_link_at IS NOT NULL)::integer AS link_click_count,
             COUNT(*) FILTER (WHERE clicked_button_at IS NOT NULL)::integer AS button_click_count
        FROM public.whatsapp_campaign_recipients
       WHERE campaign_id = _campaign_id
       GROUP BY campaign_id
    ) s
   WHERE c.id = _campaign_id
     AND s.campaign_id = c.id;

  UPDATE public.whatsapp_campaigns
     SET response_count = 0,
         called_count = 0,
         link_click_count = 0,
         button_click_count = 0
   WHERE id = _campaign_id
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_campaign_recipients r WHERE r.campaign_id = _campaign_id
     );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_email_campaign_engagement_counts(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _campaign_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.email_campaigns c
     SET response_count = COALESCE(s.response_count, 0),
         called_count = COALESCE(s.called_count, 0),
         link_click_count = COALESCE(s.link_click_count, 0),
         button_click_count = COALESCE(s.button_click_count, 0)
    FROM (
      SELECT campaign_id,
             COUNT(*) FILTER (WHERE responded_at IS NOT NULL)::integer AS response_count,
             COUNT(*) FILTER (WHERE called_at IS NOT NULL)::integer AS called_count,
             COUNT(*) FILTER (WHERE clicked_link_at IS NOT NULL)::integer AS link_click_count,
             COUNT(*) FILTER (WHERE clicked_button_at IS NOT NULL)::integer AS button_click_count
        FROM public.email_campaign_recipients
       WHERE campaign_id = _campaign_id
       GROUP BY campaign_id
    ) s
   WHERE c.id = _campaign_id
     AND s.campaign_id = c.id;

  UPDATE public.email_campaigns
     SET response_count = 0,
         called_count = 0,
         link_click_count = 0,
         button_click_count = 0
   WHERE id = _campaign_id
     AND NOT EXISTS (
       SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id = _campaign_id
     );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_whatsapp_campaign_engagement_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_whatsapp_campaign_engagement_counts(COALESCE(NEW.campaign_id, OLD.campaign_id));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_email_campaign_engagement_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_email_campaign_engagement_counts(COALESCE(NEW.campaign_id, OLD.campaign_id));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_whatsapp_campaign_engagement_counts ON public.whatsapp_campaign_recipients;
CREATE TRIGGER trg_refresh_whatsapp_campaign_engagement_counts
AFTER INSERT OR UPDATE OR DELETE
ON public.whatsapp_campaign_recipients
FOR EACH ROW
EXECUTE FUNCTION public.fn_refresh_whatsapp_campaign_engagement_counts();

DROP TRIGGER IF EXISTS trg_refresh_email_campaign_engagement_counts ON public.email_campaign_recipients;
CREATE TRIGGER trg_refresh_email_campaign_engagement_counts
AFTER INSERT OR UPDATE OR DELETE
ON public.email_campaign_recipients
FOR EACH ROW
EXECUTE FUNCTION public.fn_refresh_email_campaign_engagement_counts();

CREATE OR REPLACE FUNCTION public.fn_mark_campaign_recipient_whatsapp_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_context record;
  v_phone text;
  v_business text;
  v_is_button boolean;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  v_phone := regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
  v_business := regexp_replace(COALESCE(NEW.business_phone_number_id, NEW.business_phone_number, ''), '[^0-9]', '', 'g');
  v_is_button := NEW.message_type IN ('interactive', 'button');

  SELECT woc.campaign_recipient_id, woc.campaign_id
    INTO v_context
    FROM public.whatsapp_outbound_context woc
   WHERE woc.campaign_recipient_id IS NOT NULL
     AND woc.phone = v_phone
     AND woc.created_at <= COALESCE(NEW.created_at, now())
     AND (woc.expires_at IS NULL OR woc.expires_at >= COALESCE(NEW.created_at, now()))
     AND (
       v_business = ''
       OR COALESCE(regexp_replace(woc.business_number, '[^0-9]', '', 'g'), '') = ''
       OR regexp_replace(woc.business_number, '[^0-9]', '', 'g') = v_business
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

DROP TRIGGER IF EXISTS trg_mark_campaign_recipient_whatsapp_response ON public.whatsapp_messages;
CREATE TRIGGER trg_mark_campaign_recipient_whatsapp_response
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.fn_mark_campaign_recipient_whatsapp_response();

CREATE OR REPLACE FUNCTION public.fn_mark_campaign_recipient_called()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_whatsapp_recipient_id uuid;
  v_email_recipient_id uuid;
BEGIN
  IF NEW.lead_id IS NULL OR NEW.called_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id
    INTO v_whatsapp_recipient_id
    FROM public.whatsapp_campaign_recipients r
   WHERE r.lead_id = NEW.lead_id
     AND r.sent_at IS NOT NULL
     AND r.sent_at <= NEW.called_at
     AND NEW.called_at <= r.sent_at + interval '30 days'
     AND r.status IN ('sent', 'delivered', 'read')
   ORDER BY r.sent_at DESC
   LIMIT 1;

  IF v_whatsapp_recipient_id IS NOT NULL THEN
    UPDATE public.whatsapp_campaign_recipients
       SET called_at = COALESCE(called_at, NEW.called_at),
           call_disposition = COALESCE(NEW.disposition, call_disposition),
           call_notes = COALESCE(NEW.notes, call_notes),
           call_log_id = COALESCE(call_log_id, NEW.id)
     WHERE id = v_whatsapp_recipient_id;
  END IF;

  SELECT r.id
    INTO v_email_recipient_id
    FROM public.email_campaign_recipients r
   WHERE r.lead_id = NEW.lead_id
     AND r.sent_at IS NOT NULL
     AND r.sent_at <= NEW.called_at
     AND NEW.called_at <= r.sent_at + interval '30 days'
     AND r.status IN ('sent')
   ORDER BY r.sent_at DESC
   LIMIT 1;

  IF v_email_recipient_id IS NOT NULL THEN
    UPDATE public.email_campaign_recipients
       SET called_at = COALESCE(called_at, NEW.called_at),
           call_disposition = COALESCE(NEW.disposition, call_disposition),
           call_notes = COALESCE(NEW.notes, call_notes),
           call_log_id = COALESCE(call_log_id, NEW.id)
     WHERE id = v_email_recipient_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_campaign_recipient_called ON public.call_logs;
CREATE TRIGGER trg_mark_campaign_recipient_called
AFTER INSERT OR UPDATE OF lead_id, called_at, disposition, notes
ON public.call_logs
FOR EACH ROW
EXECUTE FUNCTION public.fn_mark_campaign_recipient_called();

WITH matches AS (
  SELECT r.id AS recipient_id,
         cl.id AS call_log_id,
         cl.called_at,
         cl.disposition,
         cl.notes
    FROM public.whatsapp_campaign_recipients r
    JOIN LATERAL (
      SELECT id, called_at, disposition, notes
        FROM public.call_logs
       WHERE lead_id = r.lead_id
         AND called_at >= r.sent_at
         AND called_at <= r.sent_at + interval '30 days'
       ORDER BY called_at ASC
       LIMIT 1
    ) cl ON true
   WHERE r.called_at IS NULL
     AND r.sent_at IS NOT NULL
     AND r.status IN ('sent', 'delivered', 'read')
)
UPDATE public.whatsapp_campaign_recipients r
   SET called_at = matches.called_at,
       call_disposition = matches.disposition,
       call_notes = matches.notes,
       call_log_id = matches.call_log_id
  FROM matches
 WHERE r.id = matches.recipient_id;

WITH matches AS (
  SELECT r.id AS recipient_id,
         cl.id AS call_log_id,
         cl.called_at,
         cl.disposition,
         cl.notes
    FROM public.email_campaign_recipients r
    JOIN LATERAL (
      SELECT id, called_at, disposition, notes
        FROM public.call_logs
       WHERE lead_id = r.lead_id
         AND called_at >= r.sent_at
         AND called_at <= r.sent_at + interval '30 days'
       ORDER BY called_at ASC
       LIMIT 1
    ) cl ON true
   WHERE r.called_at IS NULL
     AND r.sent_at IS NOT NULL
     AND r.status = 'sent'
)
UPDATE public.email_campaign_recipients r
   SET called_at = matches.called_at,
       call_disposition = matches.disposition,
       call_notes = matches.notes,
       call_log_id = matches.call_log_id
  FROM matches
 WHERE r.id = matches.recipient_id;

SELECT public.refresh_whatsapp_campaign_engagement_counts(id) FROM public.whatsapp_campaigns;
SELECT public.refresh_email_campaign_engagement_counts(id) FROM public.email_campaigns;

GRANT EXECUTE ON FUNCTION public.refresh_whatsapp_campaign_engagement_counts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_email_campaign_engagement_counts(uuid) TO authenticated, service_role;
