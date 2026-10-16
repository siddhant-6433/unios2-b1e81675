-- crm intake active paging
-- keep-migration-version: already recorded on production schema_migrations

-- Intake means actionable, non-terminal leads. Never mix DNC/rejected/deferred
-- records into a counsellor's fresh queue, and allow managers to page through
-- the complete queue while retaining exact unassigned totals.
CREATE OR REPLACE FUNCTION public.crm_counsellor_has_capacity(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=p_profile_id AND p.archived_at IS NULL AND p.deleted_at IS NULL
      AND coalesce(p.login_disabled,false)=false AND p.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.user_id AND ur.role::text='counsellor')
      AND coalesce((SELECT c.is_available FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),true)
      AND (coalesce((SELECT c.max_active_leads FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),0)=0
        OR (SELECT count(*) FROM public.leads l WHERE l.counsellor_id=p.id AND l.archived_at IS NULL
          AND l.stage::text NOT IN ('admitted','rejected','cold','not_interested','ineligible','dnc','deferred','course_not_available')) <
          (SELECT c.max_active_leads FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id))
      AND (coalesce((SELECT c.max_pending_actions FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),0)=0
        OR (SELECT count(*) FROM public.lead_followups f WHERE f.user_id=p.user_id AND f.status='pending'
          AND f.type IS DISTINCT FROM 'cold_followup') <
          (SELECT c.max_pending_actions FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id))
  );
$$;

DROP FUNCTION public.crm_intake_capacity_snapshot(integer);
CREATE FUNCTION public.crm_intake_capacity_snapshot(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_counsellors jsonb; v_leads jsonb; v_total integer; v_limit integer;
  v_offset integer:=greatest(0,least(coalesce(p_offset,0),100000));
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  v_limit:=greatest(1,least(coalesce(p_limit,100),200));

  WITH staff AS (
    SELECT p.id,p.user_id,coalesce(nullif(btrim(p.display_name),''),'Unnamed') AS name,
      coalesce(c.is_available,true) AS configured_available,coalesce(c.max_active_leads,0) AS max_active_leads,
      coalesce(c.max_pending_actions,0) AS max_pending_actions,
      (SELECT count(*)::integer FROM public.leads l WHERE l.counsellor_id=p.id AND l.archived_at IS NULL
        AND l.stage::text NOT IN ('admitted','rejected','cold','not_interested','ineligible','dnc','deferred','course_not_available')) AS active_leads,
      (SELECT count(*)::integer FROM public.lead_followups f WHERE f.user_id=p.user_id AND f.status='pending'
        AND f.type IS DISTINCT FROM 'cold_followup') AS pending_actions
    FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.user_id AND ur.role::text='counsellor'
    LEFT JOIN public.crm_counsellor_capacity c ON c.profile_id=p.id
    WHERE p.archived_at IS NULL AND p.deleted_at IS NULL AND coalesce(p.login_disabled,false)=false
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'is_available',s.configured_available,
    'eligible',public.crm_counsellor_has_capacity(s.id),'max_active_leads',s.max_active_leads,
    'max_pending_actions',s.max_pending_actions,'active_leads',s.active_leads,'pending_actions',s.pending_actions)
    ORDER BY s.name),'[]'::jsonb) INTO v_counsellors FROM staff s;

  SELECT count(*)::integer INTO v_total FROM public.leads l
  WHERE l.counsellor_id IS NULL AND l.archived_at IS NULL
    AND l.stage::text NOT IN ('admitted','rejected','cold','not_interested','ineligible','dnc','deferred','course_not_available')
    AND public.user_can_access_record_campus(v_user,l.campus_id);
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.priority,q.temperature_priority,q.created_at DESC,q.id),'[]'::jsonb) INTO v_leads
  FROM (
    SELECT l.id,l.name,l.phone,l.source::text AS source,l.stage::text AS stage,l.lead_score,l.lead_temperature,
      l.created_at,l.campus_id,ca.name AS campus_name,co.name AS course_name,
      coalesce((SELECT min(r.priority) FROM public.lead_allocation_rules r WHERE r.is_active
        AND public.crm_lead_allocation_rule_matches(r.conditions,l.id)),999) AS priority,
      CASE l.lead_temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END AS temperature_priority
    FROM public.leads l LEFT JOIN public.campuses ca ON ca.id=l.campus_id LEFT JOIN public.courses co ON co.id=l.course_id
    WHERE l.counsellor_id IS NULL AND l.archived_at IS NULL
      AND l.stage::text NOT IN ('admitted','rejected','cold','not_interested','ineligible','dnc','deferred','course_not_available')
      AND public.user_can_access_record_campus(v_user,l.campus_id)
    ORDER BY priority,temperature_priority,l.created_at DESC,l.id
    LIMIT v_limit OFFSET v_offset
  ) q;
  RETURN jsonb_build_object('as_of',now(),'total_unassigned',v_total,'counsellors',v_counsellors,'leads',v_leads,
    'limit',v_limit,'offset',v_offset,'has_more',v_offset+jsonb_array_length(v_leads)<v_total);
END $$;

REVOKE ALL ON FUNCTION public.crm_intake_capacity_snapshot(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_intake_capacity_snapshot(integer,integer) TO authenticated;
