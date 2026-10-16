-- keep-migration-version: already recorded on production schema_migrations
-- intake rule condition matching

-- A configured allocation rule is a conjunction: every provided condition must
-- match. Empty rules are the explicit catch-all.
CREATE OR REPLACE FUNCTION public.crm_lead_allocation_rule_matches(p_conditions jsonb,p_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    LEFT JOIN public.campuses ca ON ca.id=l.campus_id
    LEFT JOIN public.courses co ON co.id=l.course_id
    WHERE l.id=p_lead_id
      AND (coalesce(p_conditions,'{}'::jsonb)='{}'::jsonb OR (
        (NOT (p_conditions ? 'source') OR p_conditions->>'source'=l.source::text) AND
        (NOT (p_conditions ? 'campus') OR p_conditions->>'campus'=ca.name) AND
        (NOT (p_conditions ? 'course') OR p_conditions->>'course'=co.name) AND
        (NOT (p_conditions ? 'city') OR p_conditions->>'city'=l.city)
      ))
  );
$$;
REVOKE ALL ON FUNCTION public.crm_lead_allocation_rule_matches(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_lead_allocation_rule_matches(jsonb,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.crm_intake_capacity_snapshot(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_counsellors jsonb; v_leads jsonb; v_total integer;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  WITH staff AS (
    SELECT p.id,p.user_id,coalesce(nullif(btrim(p.display_name),''),'Unnamed') AS name,
      coalesce(c.is_available,true) AS configured_available,coalesce(c.max_active_leads,0) AS max_active_leads,
      coalesce(c.max_pending_actions,0) AS max_pending_actions,
      (SELECT count(*)::integer FROM public.leads l WHERE l.counsellor_id=p.id AND l.archived_at IS NULL
        AND l.stage::text NOT IN ('admitted','rejected','cold')) AS active_leads,
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
  WHERE l.counsellor_id IS NULL AND l.archived_at IS NULL AND l.stage::text NOT IN ('admitted','rejected','cold')
    AND public.user_can_access_record_campus(v_user,l.campus_id);
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.priority,q.created_at DESC),'[]'::jsonb) INTO v_leads
  FROM (
    SELECT l.id,l.name,l.phone,l.source::text AS source,l.stage::text AS stage,l.lead_score,l.lead_temperature,
      l.created_at,l.campus_id,ca.name AS campus_name,co.name AS course_name,
      coalesce((SELECT min(r.priority) FROM public.lead_allocation_rules r WHERE r.is_active
        AND public.crm_lead_allocation_rule_matches(r.conditions,l.id)),999) AS priority
    FROM public.leads l LEFT JOIN public.campuses ca ON ca.id=l.campus_id LEFT JOIN public.courses co ON co.id=l.course_id
    WHERE l.counsellor_id IS NULL AND l.archived_at IS NULL AND l.stage::text NOT IN ('admitted','rejected','cold')
      AND public.user_can_access_record_campus(v_user,l.campus_id)
    ORDER BY priority,l.created_at DESC,l.id LIMIT greatest(1,least(coalesce(p_limit,100),200))
  ) q;
  RETURN jsonb_build_object('as_of',now(),'total_unassigned',v_total,'counsellors',v_counsellors,'leads',v_leads,
    'limit',greatest(1,least(coalesce(p_limit,100),200)));
END $$;

CREATE OR REPLACE FUNCTION public.fn_intake_round_robin_assign(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lead public.leads%ROWTYPE; v_pool uuid[]; v_counsellor_id uuid; v_user_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.counsellor_id IS NOT NULL THEN RETURN v_lead.counsellor_id; END IF;
  SELECT r.round_robin_pool INTO v_pool FROM public.lead_allocation_rules r
  WHERE r.is_active AND r.is_intake_pool AND r.assignment_type='round_robin'
    AND coalesce(cardinality(r.round_robin_pool),0)>0
    AND public.crm_lead_allocation_rule_matches(r.conditions,_lead_id)
  ORDER BY r.priority,r.created_at LIMIT 1;
  IF coalesce(cardinality(v_pool),0)=0 THEN RETURN NULL; END IF;

  WITH pool_profiles AS (
    SELECT p.id AS profile_id,p.user_id,(p.last_seen_at IS NOT NULL AND p.last_seen_at>now()-interval '2 minutes') AS online
    FROM public.profiles p WHERE p.user_id=ANY(v_pool)
      AND public.user_can_access_record_campus(p.user_id,v_lead.campus_id)
      AND public.crm_counsellor_has_capacity(p.id)
  ), eligible AS (
    SELECT * FROM pool_profiles p WHERE p.online OR NOT EXISTS(SELECT 1 FROM pool_profiles WHERE online)
  ), loads AS (
    SELECT e.profile_id,e.user_id,(SELECT count(*) FROM public.lead_followups f WHERE f.user_id=e.user_id AND f.status='pending') AS load
    FROM eligible e
  ) SELECT profile_id,user_id INTO v_counsellor_id,v_user_id FROM loads ORDER BY load,random() LIMIT 1;
  IF v_counsellor_id IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_counsellor_id::text),0);
  IF NOT public.crm_counsellor_has_capacity(v_counsellor_id) THEN RETURN NULL; END IF;
  UPDATE public.leads SET counsellor_id=v_counsellor_id,updated_at=now() WHERE id=_lead_id;
  INSERT INTO public.lead_assignment_history(lead_id,assigned_to,assignment_source,bucket_name,lead_stage_at_assignment)
  VALUES(_lead_id,v_counsellor_id,'assigned','Inbound intake pool',v_lead.stage);
  INSERT INTO public.lead_activities(lead_id,type,description)
  VALUES(_lead_id,'system','Auto-assigned via capacity-aware, condition-matched intake round-robin.');
  RETURN v_counsellor_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_intake_capacity_snapshot(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_intake_capacity_snapshot(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intake_round_robin_assign(uuid) TO authenticated,service_role;
