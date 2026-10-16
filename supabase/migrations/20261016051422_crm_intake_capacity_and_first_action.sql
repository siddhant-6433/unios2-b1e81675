-- keep-migration-version: already recorded on production schema_migrations
-- crm intake capacity and first action

-- Explicit counsellor availability/capacity. Zero means uncapped so legacy
-- round-robin behavior remains until an administrator sets a limit.
CREATE TABLE public.crm_counsellor_capacity (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_available boolean NOT NULL DEFAULT true,
  max_active_leads integer NOT NULL DEFAULT 0 CHECK (max_active_leads >= 0),
  max_pending_actions integer NOT NULL DEFAULT 0 CHECK (max_pending_actions >= 0),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_counsellor_capacity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_counsellor_capacity FROM anon, authenticated;
DROP POLICY IF EXISTS crm_counsellor_capacity_manager_read ON public.crm_counsellor_capacity;
CREATE POLICY crm_counsellor_capacity_manager_read ON public.crm_counsellor_capacity FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'campus_admin') OR
  public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'vice_principal') OR
  public.has_role(auth.uid(),'admission_head')
);
GRANT SELECT ON public.crm_counsellor_capacity TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_counsellor_has_capacity(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=p_profile_id AND p.archived_at IS NULL AND p.deleted_at IS NULL
      AND coalesce(p.login_disabled,false)=false AND p.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.user_id AND ur.role::text='counsellor')
      AND coalesce((SELECT c.is_available FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),true)
      AND (coalesce((SELECT c.max_active_leads FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),0)=0
        OR (SELECT count(*) FROM public.leads l WHERE l.counsellor_id=p.id AND l.archived_at IS NULL
          AND l.stage::text NOT IN ('admitted','rejected','cold')) <
          (SELECT c.max_active_leads FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id))
      AND (coalesce((SELECT c.max_pending_actions FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id),0)=0
        OR (SELECT count(*) FROM public.lead_followups f WHERE f.user_id=p.user_id AND f.status='pending'
          AND f.type IS DISTINCT FROM 'cold_followup') <
          (SELECT c.max_pending_actions FROM public.crm_counsellor_capacity c WHERE c.profile_id=p.id))
  );
$$;
REVOKE ALL ON FUNCTION public.crm_counsellor_has_capacity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_counsellor_has_capacity(uuid) TO authenticated, service_role;

-- Every newly-owned fresh lead starts with one primary first-contact task at
-- the source SLA deadline. Lead ownership and task creation share a transaction.
CREATE OR REPLACE FUNCTION public.crm_create_first_contact_action_on_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_hours integer;
BEGIN
  IF NEW.counsellor_id IS NULL OR NEW.counsellor_id IS NOT DISTINCT FROM OLD.counsellor_id
    OR NEW.archived_at IS NOT NULL OR NEW.stage::text <> 'new_lead' OR NEW.first_contact_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.user_id INTO v_user_id FROM public.profiles p WHERE p.id=NEW.counsellor_id;
  SELECT coalesce(s.first_contact_hours,4) INTO v_hours FROM public.source_sla_config s WHERE s.source=NEW.source::text;
  v_hours := coalesce(v_hours,4);
  IF v_user_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_followups f WHERE f.lead_id=NEW.id AND f.status='pending' AND f.is_primary) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.lead_followups(lead_id,user_id,scheduled_at,type,status,notes,is_primary)
  VALUES(NEW.id,v_user_id,coalesce(NEW.assigned_at,now())+make_interval(hours=>v_hours),
    'call','pending','First response: contact the new lead and record the outcome.',true);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_create_first_contact_action_on_assignment ON public.leads;
CREATE TRIGGER crm_create_first_contact_action_on_assignment
  AFTER UPDATE OF counsellor_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.crm_create_first_contact_action_on_assignment();

CREATE OR REPLACE FUNCTION public.crm_set_counsellor_capacity(
  p_profile_id uuid,p_is_available boolean,p_max_active_leads integer,p_max_pending_actions integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'campus_admin')
    OR public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'vice_principal') OR public.has_role(auth.uid(),'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  IF p_max_active_leads<0 OR p_max_pending_actions<0 THEN RAISE EXCEPTION 'Capacity limits cannot be negative'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_profile_id
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.user_id AND ur.role::text='counsellor'))
  THEN RAISE EXCEPTION 'Counsellor not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::text),0);
  INSERT INTO public.crm_counsellor_capacity(profile_id,is_available,max_active_leads,max_pending_actions,updated_by,updated_at)
  VALUES(p_profile_id,p_is_available,p_max_active_leads,p_max_pending_actions,auth.uid(),now())
  ON CONFLICT(profile_id) DO UPDATE SET is_available=EXCLUDED.is_available,
    max_active_leads=EXCLUDED.max_active_leads,max_pending_actions=EXCLUDED.max_pending_actions,
    updated_by=EXCLUDED.updated_by,updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.crm_intake_capacity_snapshot(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_counsellors jsonb; v_leads jsonb; v_total integer;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  WITH staff AS (
    SELECT p.id,p.user_id,coalesce(nullif(btrim(p.display_name),''),'Unnamed') AS name,
      coalesce(c.is_available,true) AS configured_available,
      coalesce(c.max_active_leads,0) AS max_active_leads,
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
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.priority, q.created_at DESC),'[]'::jsonb) INTO v_leads
  FROM (
    SELECT l.id,l.name,l.phone,l.source::text AS source,l.stage::text AS stage,l.lead_score,l.lead_temperature,
      l.created_at,l.campus_id,ca.name AS campus_name,c.name AS course_name,
      coalesce((SELECT min(r.priority) FROM public.lead_allocation_rules r WHERE r.is_active
        AND (r.conditions='{}'::jsonb OR r.conditions->>'source'=l.source::text
          OR r.conditions->>'campus'=ca.name OR r.conditions->>'course'=c.name)),999) AS priority
    FROM public.leads l LEFT JOIN public.campuses ca ON ca.id=l.campus_id LEFT JOIN public.courses c ON c.id=l.course_id
    WHERE l.counsellor_id IS NULL AND l.archived_at IS NULL AND l.stage::text NOT IN ('admitted','rejected','cold')
      AND public.user_can_access_record_campus(v_user,l.campus_id)
    ORDER BY priority,l.created_at DESC,l.id LIMIT greatest(1,least(coalesce(p_limit,100),200))
  ) q;
  RETURN jsonb_build_object('as_of',now(),'total_unassigned',v_total,'counsellors',v_counsellors,'leads',v_leads,
    'limit',greatest(1,least(coalesce(p_limit,100),200)));
END $$;

CREATE OR REPLACE FUNCTION public.crm_assign_intake_lead(p_lead_id uuid,p_counsellor_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_lead public.leads%ROWTYPE; v_assigned_by uuid;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Enter an assignment reason'; END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_lead.counsellor_id IS NOT NULL OR v_lead.stage::text IN ('admitted','rejected','cold')
  THEN RAISE EXCEPTION 'Lead is no longer available in the intake queue'; END IF;
  IF NOT public.user_can_access_record_campus(v_user,v_lead.campus_id) THEN RAISE EXCEPTION 'Campus access denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_counsellor_id::text),0);
  IF NOT public.crm_counsellor_has_capacity(p_counsellor_id) THEN RAISE EXCEPTION 'Counsellor is unavailable or at configured capacity'; END IF;
  SELECT id INTO v_assigned_by FROM public.profiles WHERE user_id=v_user LIMIT 1;
  UPDATE public.leads SET counsellor_id=p_counsellor_id,updated_at=now() WHERE id=p_lead_id;
  INSERT INTO public.lead_assignment_history(lead_id,assigned_to,previous_counsellor_id,assigned_by_profile_id,
    assigned_by_user_id,assignment_source,bucket_name,lead_stage_at_assignment)
  VALUES(p_lead_id,p_counsellor_id,NULL,v_assigned_by,v_user,'assigned','CRM Intake',v_lead.stage);
  INSERT INTO public.lead_activities(lead_id,user_id,type,description)
  VALUES(p_lead_id,v_user,'system','Intake assignment: '||btrim(p_reason));
  RETURN p_counsellor_id;
END $$;

-- Capacity-aware routing preserves the existing team/source candidate rules.
CREATE OR REPLACE FUNCTION public.fn_intake_round_robin_assign(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lead public.leads%ROWTYPE; v_pool uuid[]; v_counsellor_id uuid; v_assigned_user uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.counsellor_id IS NOT NULL THEN RETURN v_lead.counsellor_id; END IF;
  SELECT round_robin_pool INTO v_pool FROM public.lead_allocation_rules
  WHERE is_active AND is_intake_pool AND assignment_type='round_robin' AND coalesce(cardinality(round_robin_pool),0)>0
  ORDER BY priority,created_at LIMIT 1;
  IF coalesce(cardinality(v_pool),0)=0 THEN RETURN NULL; END IF;
  WITH pool_profiles AS (
    SELECT p.id AS profile_id,p.user_id,(p.last_seen_at IS NOT NULL AND p.last_seen_at>now()-interval '2 minutes') AS online
    FROM public.profiles p WHERE p.user_id=ANY(v_pool) AND public.crm_counsellor_has_capacity(p.id)
  ), eligible AS (
    SELECT * FROM pool_profiles p WHERE p.online OR NOT EXISTS(SELECT 1 FROM pool_profiles WHERE online)
  ), loads AS (
    SELECT e.profile_id,e.user_id,(SELECT count(*) FROM public.lead_followups f WHERE f.user_id=e.user_id AND f.status='pending') AS load
    FROM eligible e
  ) SELECT profile_id,user_id INTO v_counsellor_id,v_assigned_user FROM loads ORDER BY load,random() LIMIT 1;
  IF v_counsellor_id IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_counsellor_id::text),0);
  IF NOT public.crm_counsellor_has_capacity(v_counsellor_id) THEN RETURN NULL; END IF;
  UPDATE public.leads SET counsellor_id=v_counsellor_id,updated_at=now() WHERE id=_lead_id;
  INSERT INTO public.lead_assignment_history(lead_id,assigned_to,assigned_by_profile_id,assignment_source,bucket_name,lead_stage_at_assignment)
  VALUES(_lead_id,v_counsellor_id,NULL,'assigned','Inbound intake pool',v_lead.stage);
  INSERT INTO public.lead_activities(lead_id,type,description) VALUES(_lead_id,'system','Auto-assigned via capacity-aware intake round-robin.');
  RETURN v_counsellor_id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_round_robin_assign_counsellor(_lead_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_lead public.leads%ROWTYPE; v_teams text[]; v_counsellor_id uuid; v_user_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_lead.counsellor_id IS NOT NULL THEN RETURN v_lead.counsellor_id; END IF;
  v_teams:=public.fn_teams_for_lead(_lead_id);
  WITH eligible AS (
    SELECT DISTINCT p.id AS profile_id,p.user_id FROM public.teams t JOIN public.team_members tm ON tm.team_id=t.id
    JOIN public.profiles p ON p.user_id=tm.user_id JOIN public.user_roles ur ON ur.user_id=p.user_id AND ur.role::text='counsellor'
    WHERE t.name=ANY(v_teams) AND coalesce(p.login_disabled,false)=false AND p.archived_at IS NULL AND p.deleted_at IS NULL
      AND public.crm_counsellor_has_capacity(p.id)
  ),loads AS (SELECT e.profile_id,e.user_id,(SELECT count(*) FROM public.lead_followups f WHERE f.user_id=e.user_id AND f.status='pending') AS load FROM eligible e)
  SELECT profile_id,user_id INTO v_counsellor_id,v_user_id FROM loads ORDER BY load,random() LIMIT 1;
  IF v_counsellor_id IS NULL AND NOT ('Grn Counselling'=ANY(v_teams)) THEN
    WITH eligible AS (
      SELECT p.id AS profile_id,p.user_id FROM public.teams t JOIN public.team_members tm ON tm.team_id=t.id
      JOIN public.profiles p ON p.user_id=tm.user_id JOIN public.user_roles ur ON ur.user_id=p.user_id AND ur.role::text='counsellor'
      WHERE t.name='Grn Counselling' AND coalesce(p.login_disabled,false)=false AND p.archived_at IS NULL AND p.deleted_at IS NULL
        AND public.crm_counsellor_has_capacity(p.id)
    ),loads AS (SELECT e.profile_id,e.user_id,(SELECT count(*) FROM public.lead_followups f WHERE f.user_id=e.user_id AND f.status='pending') AS load FROM eligible e)
    SELECT profile_id,user_id INTO v_counsellor_id,v_user_id FROM loads ORDER BY load,random() LIMIT 1;
  END IF;
  IF v_counsellor_id IS NULL THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_counsellor_id::text),0);
  IF NOT public.crm_counsellor_has_capacity(v_counsellor_id) THEN RETURN NULL; END IF;
  UPDATE public.leads SET counsellor_id=v_counsellor_id,updated_at=now() WHERE id=_lead_id;
  INSERT INTO public.lead_assignment_history(lead_id,assigned_to,assignment_source,lead_stage_at_assignment)
  VALUES(_lead_id,v_counsellor_id,'assigned',v_lead.stage);
  INSERT INTO public.lead_activities(lead_id,type,description)
  VALUES(_lead_id,'system',format('Auto-assigned via capacity-aware round-robin (teams: %s)',array_to_string(v_teams,', ')));
  RETURN v_counsellor_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_set_counsellor_capacity(uuid,boolean,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_intake_capacity_snapshot(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_assign_intake_lead(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_set_counsellor_capacity(uuid,boolean,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_intake_capacity_snapshot(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_assign_intake_lead(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_intake_round_robin_assign(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_round_robin_assign_counsellor(uuid) TO authenticated,service_role;
