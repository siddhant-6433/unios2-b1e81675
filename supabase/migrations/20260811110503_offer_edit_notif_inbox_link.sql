-- Point the "Offer letter edit pending approval" notification at the new Inbox
-- category instead of the lead page (which has no approval surface).
-- Only the deep-link changes; the requester-decided notification still targets
-- the lead page (the counsellor can't approve, so the inbox is useless to them).

CREATE OR REPLACE FUNCTION public.notify_offer_edit_request_pending()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead_id   uuid;
  v_lead_name text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT o.lead_id, l.name
    INTO v_lead_id, v_lead_name
    FROM public.offer_letters o
    JOIN public.leads l ON l.id = o.lead_id
   WHERE o.id = NEW.offer_letter_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
  SELECT
    ur.user_id,
    'approval_pending',
    'Offer letter edit pending approval',
    COALESCE(NEW.requested_by_name, 'Staff') || ' requested edits to the offer letter for ' ||
      COALESCE(v_lead_name, 'a lead') ||
      CASE WHEN NEW.reason IS NOT NULL AND NEW.reason <> ''
           THEN ': ' || NEW.reason ELSE '' END,
    '/inbox?category=offer_edits',
    v_lead_id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin';

  RETURN NEW;
END;
$$;
