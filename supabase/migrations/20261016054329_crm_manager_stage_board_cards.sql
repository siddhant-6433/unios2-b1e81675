-- keep-migration-version: already recorded on production schema_migrations
-- crm manager stage board cards

-- Current lifecycle board with exact scoped totals and a small actionable lead
-- preview per stage. Counts are computed over the full visible set.
CREATE OR REPLACE FUNCTION public.crm_manager_stage_board_snapshot(p_cards_per_stage integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_stages jsonb; v_cards integer:=greatest(1,least(coalesce(p_cards_per_stage,3),5));
BEGIN
  IF v_user IS NULL OR NOT (public.has_role(v_user,'super_admin') OR public.has_role(v_user,'campus_admin')
    OR public.has_role(v_user,'principal') OR public.has_role(v_user,'vice_principal') OR public.has_role(v_user,'admission_head'))
  THEN RAISE EXCEPTION 'Manager permission required' USING ERRCODE='42501'; END IF;

  WITH stage_catalog AS (
    SELECT unnest(enum_range(NULL::public.lead_stage)) AS stage
  ), scoped_leads AS MATERIALIZED (
    SELECT l.id,l.name,l.phone,l.stage,l.lead_score,l.lead_temperature::text AS lead_temperature,
      l.counsellor_id,l.created_at
    FROM public.leads l
    WHERE l.archived_at IS NULL AND public.user_can_access_record_campus(v_user,l.campus_id)
  ), totals AS (
    SELECT stage,count(*)::integer AS lead_count FROM scoped_leads GROUP BY stage
  ), ranked AS (
    SELECT s.*,row_number() OVER(PARTITION BY s.stage ORDER BY
      CASE s.lead_temperature WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 ELSE 3 END,
      s.lead_score DESC NULLS LAST,s.created_at DESC,s.id) AS position
    FROM scoped_leads s
  ), previews AS (
    SELECT stage,coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'lead_score',lead_score,
      'lead_temperature',lead_temperature,'counsellor_id',counsellor_id,'created_at',created_at)
      ORDER BY position),'[]'::jsonb) AS leads
    FROM ranked WHERE position<=v_cards GROUP BY stage
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('stage',c.stage::text,'count',coalesce(t.lead_count,0),
    'leads',coalesce(p.leads,'[]'::jsonb)) ORDER BY c.stage),'[]'::jsonb)
  INTO v_stages FROM stage_catalog c LEFT JOIN totals t ON t.stage=c.stage LEFT JOIN previews p ON p.stage=c.stage;

  RETURN jsonb_build_object('as_of',now(),'metric_scope','non_archived_leads_visible_to_the_caller',
    'cards_per_stage',v_cards,'stages',v_stages);
END $$;

REVOKE ALL ON FUNCTION public.crm_manager_stage_board_snapshot(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_manager_stage_board_snapshot(integer) TO authenticated;
