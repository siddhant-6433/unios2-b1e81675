-- crm shadow temperature policy
-- keep-migration-version: already recorded on production schema_migrations

CREATE TABLE public.crm_shadow_temperature_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  hot_intent_min integer NOT NULL DEFAULT 70 CHECK (hot_intent_min BETWEEN 0 AND 100),
  hot_fit_min integer NOT NULL DEFAULT 35 CHECK (hot_fit_min BETWEEN 0 AND 100),
  cold_intent_max integer NOT NULL DEFAULT 25 CHECK (cold_intent_max BETWEEN 0 AND 100),
  cold_unanswered_min integer NOT NULL DEFAULT 3 CHECK (cold_unanswered_min BETWEEN 1 AND 10),
  cold_stale_days integer NOT NULL DEFAULT 30 CHECK (cold_stale_days BETWEEN 1 AND 180),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_shadow_temperature_policy(singleton) VALUES(true);
ALTER TABLE public.crm_shadow_temperature_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_shadow_temperature_policy FROM anon,authenticated;
DROP POLICY IF EXISTS crm_shadow_temperature_policy_authenticated_read ON public.crm_shadow_temperature_policy;
CREATE POLICY crm_shadow_temperature_policy_authenticated_read ON public.crm_shadow_temperature_policy
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.crm_shadow_temperature_policy TO authenticated;

CREATE TABLE public.crm_shadow_temperature_policy_history (
  version integer PRIMARY KEY,
  hot_intent_min integer NOT NULL,
  hot_fit_min integer NOT NULL,
  cold_intent_max integer NOT NULL,
  cold_unanswered_min integer NOT NULL,
  cold_stale_days integer NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL
);
ALTER TABLE public.crm_shadow_temperature_policy_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_shadow_temperature_policy_history_manager_read ON public.crm_shadow_temperature_policy_history;
CREATE POLICY crm_shadow_temperature_policy_history_manager_read ON public.crm_shadow_temperature_policy_history
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'campus_admin')
    OR public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'vice_principal') OR public.has_role(auth.uid(),'admission_head'));
GRANT SELECT ON public.crm_shadow_temperature_policy_history TO authenticated;
INSERT INTO public.crm_shadow_temperature_policy_history(version,hot_intent_min,hot_fit_min,cold_intent_max,
  cold_unanswered_min,cold_stale_days,changed_by,changed_at)
SELECT version,hot_intent_min,hot_fit_min,cold_intent_max,cold_unanswered_min,cold_stale_days,updated_by,updated_at
FROM public.crm_shadow_temperature_policy WHERE singleton;

-- Preserve the explainable shadow score calculation; the wrapper below changes
-- only its policy-derived temperature and version label.
ALTER FUNCTION public.crm_lead_score_shadow(uuid) RENAME TO crm_lead_score_shadow_base;
REVOKE ALL ON FUNCTION public.crm_lead_score_shadow_base(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_lead_score_shadow_base(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_shadow_temperature_policy_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_policy public.crm_shadow_temperature_policy%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_policy FROM public.crm_shadow_temperature_policy WHERE singleton;
  RETURN jsonb_build_object('version',v_policy.version,'hot_intent_min',v_policy.hot_intent_min,
    'hot_fit_min',v_policy.hot_fit_min,'cold_intent_max',v_policy.cold_intent_max,
    'cold_unanswered_min',v_policy.cold_unanswered_min,'cold_stale_days',v_policy.cold_stale_days,
    'updated_at',v_policy.updated_at,'payout_effect',false,'queue_order_effect',false);
END $$;

CREATE OR REPLACE FUNCTION public.crm_update_shadow_temperature_policy(
  p_hot_intent_min integer,p_hot_fit_min integer,p_cold_intent_max integer,
  p_cold_unanswered_min integer,p_cold_stale_days integer
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_version integer;
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;
  IF p_hot_intent_min NOT BETWEEN 0 AND 100 OR p_hot_fit_min NOT BETWEEN 0 AND 100
    OR p_cold_intent_max NOT BETWEEN 0 AND 100 OR p_cold_unanswered_min NOT BETWEEN 1 AND 10
    OR p_cold_stale_days NOT BETWEEN 1 AND 180 OR p_hot_intent_min<=p_cold_intent_max
  THEN RAISE EXCEPTION 'Temperature thresholds are outside allowed ranges or overlap'; END IF;
  UPDATE public.crm_shadow_temperature_policy SET version=version+1,hot_intent_min=p_hot_intent_min,
    hot_fit_min=p_hot_fit_min,cold_intent_max=p_cold_intent_max,cold_unanswered_min=p_cold_unanswered_min,
    cold_stale_days=p_cold_stale_days,updated_by=v_user,updated_at=now() WHERE singleton RETURNING version INTO v_version;
  INSERT INTO public.crm_shadow_temperature_policy_history(version,hot_intent_min,hot_fit_min,cold_intent_max,
    cold_unanswered_min,cold_stale_days,changed_by,changed_at)
  SELECT version,hot_intent_min,hot_fit_min,cold_intent_max,cold_unanswered_min,cold_stale_days,updated_by,updated_at
  FROM public.crm_shadow_temperature_policy WHERE singleton;
  RETURN v_version;
END $$;

CREATE OR REPLACE FUNCTION public.crm_lead_score_shadow(p_lead_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_base jsonb; v_stage text; v_unworked boolean; v_intent integer; v_fit integer; v_unanswered integer;
  v_last_engaged timestamptz; v_policy public.crm_shadow_temperature_policy%ROWTYPE; v_temperature text;
BEGIN
  v_base:=public.crm_lead_score_shadow_base(p_lead_id);
  IF v_base IS NULL THEN RETURN NULL; END IF;
  SELECT l.stage::text,l.first_contact_at IS NULL,
    greatest(l.last_engaged_at,
      (SELECT max(a.created_at) FROM public.lead_activities a WHERE a.lead_id=l.id
        AND lower(a.type) IN ('whatsapp_reply','whatsapp_inbound','inbound_message','student_reply')),
      (SELECT max(cl.called_at) FROM public.call_logs cl WHERE cl.lead_id=l.id
        AND cl.disposition IN ('interested','call_back','callback','connected')))
  INTO v_stage,v_unworked,v_last_engaged FROM public.leads l WHERE l.id=p_lead_id AND l.archived_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_policy FROM public.crm_shadow_temperature_policy WHERE singleton;
  v_intent:=coalesce((v_base->>'intent_score')::integer,0);
  v_fit:=coalesce((v_base->>'fit_score')::integer,0);
  v_unanswered:=coalesce((v_base->>'unanswered_attempts_90d')::integer,0);
  IF v_stage IN ('application_fee_paid','application_submitted','visit_scheduled','interview','offer_sent','token_paid','pre_admitted')
    OR (v_intent>=v_policy.hot_intent_min AND v_fit>=v_policy.hot_fit_min) THEN v_temperature:='hot';
  ELSIF NOT v_unworked AND v_intent<=v_policy.cold_intent_max AND v_unanswered>=v_policy.cold_unanswered_min
    AND (v_last_engaged IS NULL OR v_last_engaged<now()-make_interval(days=>v_policy.cold_stale_days)) THEN v_temperature:='cold';
  ELSE v_temperature:='warm'; END IF;
  v_base:=jsonb_set(v_base,'{temperature}',to_jsonb(v_temperature),true);
  v_base:=jsonb_set(v_base,'{version}',to_jsonb('shadow-policy-v3-'||v_policy.version::text),true);
  v_base:=jsonb_set(v_base,'{policy,thresholds}',jsonb_build_object('hot_intent_min',v_policy.hot_intent_min,
    'hot_fit_min',v_policy.hot_fit_min,'cold_intent_max',v_policy.cold_intent_max,
    'cold_unanswered_min',v_policy.cold_unanswered_min,'cold_stale_days',v_policy.cold_stale_days),true);
  RETURN v_base;
END $$;

REVOKE ALL ON FUNCTION public.crm_shadow_temperature_policy_snapshot() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_update_shadow_temperature_policy(integer,integer,integer,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_lead_score_shadow(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_shadow_temperature_policy_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_shadow_temperature_policy(integer,integer,integer,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lead_score_shadow(uuid) TO authenticated;
