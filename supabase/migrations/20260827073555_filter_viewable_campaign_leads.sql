-- Server-side lead-visibility gate for WhatsApp bulk campaign sends.
--
-- whatsapp_campaign_recipients has USING(true) RLS and INSERT granted to
-- authenticated, and whatsapp-campaign-send reads recipients with the service
-- role (bypassing RLS), so a counsellor could insert recipient rows for leads
-- they cannot see and the sender would blast them. This RPC lets the sender
-- filter a batch of lead_ids down to the ones the campaign's CREATOR was
-- actually allowed to see, reusing the canonical can_view_lead() logic.
--
-- created_by is profiles.id; can_view_lead keys off the auth user id
-- (profiles.user_id), so we resolve it here. If there is no creator (legacy /
-- system campaigns) or the profile is missing, we fail OPEN (return the whole
-- batch) to avoid breaking existing flows — this is defense-in-depth on top of
-- the frontend scoping, not the sole gate. Sees-all roles (super_admin,
-- admission_head, …) short-circuit inside can_view_lead, so admin-created
-- campaigns return the full batch unchanged.

CREATE OR REPLACE FUNCTION public.filter_viewable_campaign_leads(
  p_created_by uuid,
  p_lead_ids   uuid[]
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH creator AS (
    SELECT CASE
             WHEN p_created_by IS NULL THEN NULL
             ELSE (SELECT pr.user_id FROM public.profiles pr WHERE pr.id = p_created_by)
           END AS uid
  )
  SELECT lid
    FROM unnest(p_lead_ids) AS lid, creator
   WHERE creator.uid IS NULL
      OR public.can_view_lead(creator.uid, lid);
$$;

GRANT EXECUTE ON FUNCTION public.filter_viewable_campaign_leads(uuid, uuid[]) TO service_role, authenticated;
