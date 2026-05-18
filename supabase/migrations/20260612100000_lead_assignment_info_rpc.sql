-- RPC: lead_assignment_info(p_lead_id)
--
-- Returns minimal assignment info for a lead — the lead's name and the
-- display name of the counsellor it is currently assigned to. Used by
-- LeadDetail when the regular RLS-bound fetch returns nothing, so the UI
-- can show a "Lead currently assigned to {Counsellor}. Please get it
-- reassigned to access this lead data." message instead of a bare
-- "Lead not found".
--
-- SECURITY DEFINER on purpose: any authenticated user can resolve a
-- lead UUID to its assigned counsellor's name. We deliberately do NOT
-- return contact info, stage, or any other lead data — only the
-- assignment pointer that the user needs to ask the admin for access.
CREATE OR REPLACE FUNCTION public.lead_assignment_info(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'exists',          l.id IS NOT NULL,
    'lead_name',       l.name,
    'counsellor_name', p.display_name
  )
  FROM public.leads l
  LEFT JOIN public.profiles p ON p.id = l.counsellor_id
  WHERE l.id = p_lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_assignment_info(uuid) TO authenticated;
