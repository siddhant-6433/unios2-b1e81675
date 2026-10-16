-- keep-migration-version: already recorded on production schema_migrations
-- crm application submission queue

-- Draft applications that need counsellor help. The linked lead controls scope;
-- never expose a draft without a visible, non-archived owned/intake record.
CREATE OR REPLACE FUNCTION public.crm_application_submission_queue(p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_profile uuid; v_is_manager boolean; v_total integer; v_items jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  v_is_manager := public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head');
  IF NOT v_is_manager AND NOT public.has_role(v_user,'counsellor') THEN
    RAISE EXCEPTION 'CRM application queue access required' USING ERRCODE='42501';
  END IF;
  SELECT p.id INTO v_profile FROM public.profiles p WHERE p.user_id=v_user LIMIT 1;
  IF NOT v_is_manager AND v_profile IS NULL THEN RAISE EXCEPTION 'Counsellor profile not found' USING ERRCODE='P0002'; END IF;

  WITH scoped AS MATERIALIZED (
    SELECT a.id AS application_row_id,a.application_id,a.status AS application_status,a.payment_status,
      a.fee_amount,a.mandatory_docs_complete,a.updated_at,l.id AS lead_id,l.name AS lead_name,
      l.stage::text AS lead_stage,l.lead_score,l.lead_temperature,l.counsellor_id,l.campus_id
    FROM public.applications a JOIN public.leads l ON l.id=a.lead_id
    WHERE a.lead_id IS NOT NULL AND a.submitted_at IS NULL AND a.status IN ('draft','in_progress')
      AND l.archived_at IS NULL
      AND (v_is_manager AND public.user_can_access_record_campus(v_user,l.campus_id)
        OR NOT v_is_manager AND l.counsellor_id=v_profile)
  )
  SELECT count(*)::integer INTO v_total FROM scoped;

  WITH scoped AS MATERIALIZED (
    SELECT a.id AS application_row_id,a.application_id,a.status AS application_status,a.payment_status,
      a.fee_amount,a.mandatory_docs_complete,a.updated_at,l.id AS lead_id,l.name AS lead_name,
      l.stage::text AS lead_stage,l.lead_score,l.lead_temperature,l.counsellor_id
    FROM public.applications a JOIN public.leads l ON l.id=a.lead_id
    WHERE a.lead_id IS NOT NULL AND a.submitted_at IS NULL AND a.status IN ('draft','in_progress')
      AND l.archived_at IS NULL
      AND (v_is_manager AND public.user_can_access_record_campus(v_user,l.campus_id)
        OR NOT v_is_manager AND l.counsellor_id=v_profile)
  ), blockers AS (
    SELECT s.*, CASE
      WHEN coalesce(s.mandatory_docs_complete,false)=false THEN 'documents_incomplete'
      WHEN coalesce(s.fee_amount,0)>0 AND s.payment_status IS DISTINCT FROM 'paid' THEN 'application_fee_pending'
      ELSE 'application_not_submitted'
    END AS blocker
    FROM scoped s
  )
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.updated_at ASC,q.application_row_id),'[]'::jsonb)
  INTO v_items FROM (
    SELECT * FROM blockers ORDER BY updated_at ASC,application_row_id LIMIT greatest(1,least(coalesce(p_limit,30),100))
  ) q;
  RETURN jsonb_build_object('as_of',now(),'total',v_total,'items',v_items,'limit',greatest(1,least(coalesce(p_limit,30),100)));
END $$;

REVOKE ALL ON FUNCTION public.crm_application_submission_queue(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_application_submission_queue(integer) TO authenticated;
