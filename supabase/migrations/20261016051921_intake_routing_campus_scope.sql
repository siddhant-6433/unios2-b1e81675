-- keep-migration-version: already recorded on production schema_migrations
-- intake routing campus scope

-- Keep manual intake overrides inside the lead's campus scope. The queue RPC
-- is SECURITY DEFINER, so it must enforce both the caller and target scope.
CREATE OR REPLACE FUNCTION public.crm_assign_intake_lead(p_lead_id uuid,p_counsellor_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_lead public.leads%ROWTYPE; v_assigned_by uuid; v_target_user uuid;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Enter an assignment reason'; END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_lead.counsellor_id IS NOT NULL OR v_lead.stage::text IN ('admitted','rejected','cold')
  THEN RAISE EXCEPTION 'Lead is no longer available in the intake queue'; END IF;
  IF NOT public.user_can_access_record_campus(v_user,v_lead.campus_id) THEN RAISE EXCEPTION 'Campus access denied' USING ERRCODE='42501'; END IF;
  SELECT p.user_id INTO v_target_user FROM public.profiles p WHERE p.id=p_counsellor_id
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=p.user_id AND ur.role::text='counsellor');
  IF v_target_user IS NULL OR NOT public.user_can_access_record_campus(v_target_user,v_lead.campus_id) THEN
    RAISE EXCEPTION 'Counsellor is not assigned to this campus' USING ERRCODE='42501';
  END IF;
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

REVOKE ALL ON FUNCTION public.crm_assign_intake_lead(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_assign_intake_lead(uuid,uuid,text) TO authenticated;
