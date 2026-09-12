-- Inbox Create List was inserting a 500-row chunk into lead_list_members.
-- One duplicate (91-prefix twin chat) or one id that is a marketing_contact
-- rather than a lead 23505/23503's the whole statement, so the list is saved
-- with member_count = 0. This RPC uniques, splits lead vs contact, and skips
-- rows that cannot land.

CREATE OR REPLACE FUNCTION public.add_lead_list_members(
  _list_id uuid,
  _target_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_leads integer := 0;
  v_contacts integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_manage_lead_lists() THEN
    RAISE EXCEPTION 'Insufficient permissions to add list members';
  END IF;

  IF _list_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.lead_lists WHERE id = _list_id) THEN
    RAISE EXCEPTION 'Lead list not found';
  END IF;

  INSERT INTO public.lead_list_members (list_id, lead_id)
  SELECT DISTINCT _list_id, l.id
  FROM unnest(COALESCE(_target_ids, ARRAY[]::uuid[])) AS x(id)
  JOIN public.leads l ON l.id = x.id
  WHERE x.id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_list_members m
      WHERE m.list_id = _list_id AND m.lead_id = l.id
    );
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  INSERT INTO public.lead_list_members (list_id, contact_id)
  SELECT DISTINCT _list_id, c.id
  FROM unnest(COALESCE(_target_ids, ARRAY[]::uuid[])) AS x(id)
  JOIN public.marketing_contacts c ON c.id = x.id
  WHERE x.id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = x.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_list_members m
      WHERE m.list_id = _list_id AND m.contact_id = c.id
    );
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  RETURN jsonb_build_object(
    'lead_count', v_leads,
    'contact_count', v_contacts,
    'added', v_leads + v_contacts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_lead_list_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_lead_list_members(uuid, uuid[]) TO authenticated, service_role;
