-- Fix enum/text comparison in WhatsApp list recipient materialization.

CREATE OR REPLACE FUNCTION public.materialize_whatsapp_campaign_recipients(_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.whatsapp_campaign_recipients (campaign_id, lead_id, phone)
  SELECT _campaign_id, llm.lead_id, btrim(l.phone)
    FROM public.lead_list_members llm
    JOIN public.leads l ON l.id = llm.lead_id
   WHERE llm.list_id = v_list_id
     AND btrim(coalesce(l.phone, '')) <> ''
     AND coalesce(l.stage::text, '') <> 'dnc'
     AND NOT EXISTS (
       SELECT 1
         FROM public.whatsapp_campaign_recipients existing
        WHERE existing.campaign_id = _campaign_id
          AND existing.lead_id = llm.lead_id
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
$$;

REVOKE ALL ON FUNCTION public.materialize_whatsapp_campaign_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_whatsapp_campaign_recipients(uuid) TO authenticated;
