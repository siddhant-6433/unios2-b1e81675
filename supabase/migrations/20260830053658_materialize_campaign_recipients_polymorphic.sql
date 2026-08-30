-- lead_list_members is now polymorphic (lead OR marketing contact). This
-- function inner-joined `leads`, so after the split it would silently
-- materialise ZERO recipients for a marketing list — the campaign would look
-- like it ran and reach nobody.
--
-- It currently has no caller (the Marketing page inserts recipient rows
-- directly), but it is reachable from PostgREST and is the obvious thing to
-- refactor onto later, so it gets the same treatment as the live path rather
-- than being left as a trap.
CREATE OR REPLACE FUNCTION public.materialize_whatsapp_campaign_recipients(_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_list_id uuid;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT list_id
    INTO v_list_id
    FROM public.whatsapp_campaigns
   WHERE id = _campaign_id
   FOR UPDATE;

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'campaign % has no lead list', _campaign_id USING ERRCODE = '22023';
  END IF;

  -- Lead-backed members (unchanged behaviour).
  INSERT INTO public.whatsapp_campaign_recipients (campaign_id, lead_id, phone)
  SELECT _campaign_id, llm.lead_id, btrim(l.phone)
    FROM public.lead_list_members llm
    JOIN public.leads l ON l.id = llm.lead_id
   WHERE llm.list_id = v_list_id
     AND btrim(coalesce(l.phone, '')) <> ''
     AND coalesce(l.stage::text, '') <> 'dnc'
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_campaign_recipients existing
        WHERE existing.campaign_id = _campaign_id
          AND existing.lead_id = llm.lead_id
     );

  -- Contact-backed members. Opted-out contacts are suppressed, and a contact
  -- already promoted to a lead is skipped so the person is not messaged twice
  -- (the lead-backed row above already covers them).
  INSERT INTO public.whatsapp_campaign_recipients (campaign_id, contact_id, phone)
  SELECT _campaign_id, llm.contact_id, btrim(c.phone)
    FROM public.lead_list_members llm
    JOIN public.marketing_contacts c ON c.id = llm.contact_id
   WHERE llm.list_id = v_list_id
     AND btrim(coalesce(c.phone, '')) <> ''
     AND c.opted_out = false
     AND c.promoted_lead_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_campaign_recipients existing
        WHERE existing.campaign_id = _campaign_id
          AND existing.contact_id = llm.contact_id
     );

  SELECT count(*)
    INTO v_total
    FROM public.whatsapp_campaign_recipients
   WHERE campaign_id = _campaign_id;

  UPDATE public.whatsapp_campaigns
     SET total_recipients = v_total
   WHERE id = _campaign_id;

  RETURN v_total;
END;
$function$;
