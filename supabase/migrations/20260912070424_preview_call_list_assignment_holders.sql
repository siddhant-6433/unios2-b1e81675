-- Assign dialog showed counsellor activity (last call, other lists) but not
-- who already holds THIS list. The per-row assigned_to fetch also hit the
-- 1000-row cap and then disabled those people, so a list already with Ashraf
-- could not be re-split to include him.
--
-- preview_call_list_assignment already runs when the dialog opens. Fold in
-- the list-holder split (members.assigned_to) and the CRM counsellor split
-- so the assigner can see both before round-robin.

CREATE OR REPLACE FUNCTION public.preview_call_list_assignment(
  _list_id uuid,
  _include_terminal boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',    count(*)::int,
    'no_phone', count(*) FILTER (WHERE COALESCE(l.phone, c.phone) IS NULL)::int,
    'terminal', count(*) FILTER (
                  WHERE m.lead_id IS NOT NULL
                    AND l.phone IS NOT NULL
                    AND l.stage IN ('not_interested','dnc','rejected','ineligible','admitted'))::int,
    'dialable', count(*) FILTER (
                  WHERE CASE
                    WHEN m.contact_id IS NOT NULL
                      THEN c.phone IS NOT NULL AND NOT c.opted_out AND c.promoted_lead_id IS NULL
                    ELSE l.phone IS NOT NULL
                         AND (_include_terminal
                              OR l.stage NOT IN ('not_interested','dnc','rejected','ineligible','admitted'))
                  END)::int,
    'unassigned', count(*) FILTER (WHERE m.assigned_to IS NULL)::int,
    'holders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unknown'),
        'count', h.n
      ) ORDER BY h.n DESC, COALESCE(p.display_name, 'Unknown'))
      FROM (
        SELECT assigned_to, count(*)::int AS n
        FROM public.lead_list_members
        WHERE list_id = _list_id AND assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) h
      JOIN public.profiles p ON p.id = h.assigned_to
    ), '[]'::jsonb),
    'crm_owners', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'counsellor_id', p.id,
        'counsellor_name', COALESCE(p.display_name, 'Unknown'),
        'count', o.n
      ) ORDER BY o.n DESC, COALESCE(p.display_name, 'Unknown'))
      FROM (
        SELECT l2.counsellor_id, count(*)::int AS n
        FROM public.lead_list_members m2
        JOIN public.leads l2 ON l2.id = m2.lead_id
        WHERE m2.list_id = _list_id AND l2.counsellor_id IS NOT NULL
        GROUP BY l2.counsellor_id
      ) o
      JOIN public.profiles p ON p.id = o.counsellor_id
    ), '[]'::jsonb)
  )
  FROM public.lead_list_members m
  LEFT JOIN public.leads l              ON l.id = m.lead_id
  LEFT JOIN public.marketing_contacts c ON c.id = m.contact_id
  WHERE m.list_id = _list_id;
$function$;

REVOKE ALL ON FUNCTION public.preview_call_list_assignment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_call_list_assignment(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
