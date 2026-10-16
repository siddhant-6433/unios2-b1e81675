-- keep-migration-version: already recorded on production schema_migrations
-- crm analytics stage age and current scope

-- Keep current-state reporting aligned with Admission Analytics' canonical
-- non-archived, caller-visible cohort. Stage age follows the audited stage
-- transition, not arbitrary updates such as notes or contact edits.
CREATE OR REPLACE VIEW public.stage_aging_summary AS
SELECT l.stage::text AS stage,
  count(*) AS lead_count,
  round(avg(extract(epoch FROM (now() - coalesce(stage_event.changed_at,l.created_at))) / 86400)::numeric,1) AS avg_days_in_stage,
  max(extract(epoch FROM (now() - coalesce(stage_event.changed_at,l.created_at))) / 86400)::integer AS max_days_in_stage,
  count(*) FILTER (WHERE now() - coalesce(stage_event.changed_at,l.created_at) > interval '7 days') AS stale_count
FROM public.leads l
LEFT JOIN LATERAL (
  SELECT max(a.created_at) AS changed_at
  FROM public.lead_activities a
  WHERE a.lead_id=l.id AND a.type IN ('stage_change','status_change')
    AND a.new_stage::text=l.stage::text
) stage_event ON true
WHERE l.archived_at IS NULL AND l.stage::text NOT IN ('admitted','rejected')
GROUP BY l.stage;

CREATE OR REPLACE VIEW public.source_funnel AS
SELECT l.source::text AS source,
  count(*) AS total,
  count(*) FILTER (WHERE l.stage::text <> 'new_lead') AS contacted,
  count(*) FILTER (WHERE l.stage::text IN ('application_submitted','ai_called','counsellor_call','visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS applied,
  count(*) FILTER (WHERE l.stage::text IN ('visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS visited,
  count(*) FILTER (WHERE l.stage::text IN ('interview','offer_sent','token_paid','pre_admitted','admitted')) AS interviewed,
  count(*) FILTER (WHERE l.stage::text IN ('offer_sent','token_paid','pre_admitted','admitted')) AS offered,
  count(*) FILTER (WHERE l.stage::text IN ('token_paid','pre_admitted','admitted')) AS token_paid,
  count(*) FILTER (WHERE l.stage::text='admitted') AS admitted
FROM public.leads l WHERE l.archived_at IS NULL GROUP BY l.source;

CREATE OR REPLACE VIEW public.source_roi_summary AS
SELECT l.source::text AS source,
  date_trunc('month',l.created_at)::date AS month,
  count(*) AS total_leads,
  count(*) FILTER (WHERE l.stage::text IN ('application_submitted','ai_called','counsellor_call','visit_scheduled','interview','offer_sent','token_paid','pre_admitted','admitted')) AS applied,
  count(*) FILTER (WHERE l.stage::text='admitted') AS admitted,
  CASE WHEN count(*)>0 THEN round(count(*) FILTER (WHERE l.stage::text='admitted')::numeric/count(*)*100,1) ELSE 0 END AS conversion_pct,
  coalesce(sas.amount,0) AS ad_spend,
  CASE WHEN count(*) FILTER (WHERE l.stage::text='admitted')>0 AND sas.amount IS NOT NULL
    THEN round(sas.amount/count(*) FILTER (WHERE l.stage::text='admitted'),0) ELSE NULL END AS cost_per_admission
FROM public.leads l
LEFT JOIN public.source_ad_spend sas ON sas.source=l.source::text
  AND sas.month=date_trunc('month',l.created_at)::date AND sas.campus_id IS NULL
WHERE l.archived_at IS NULL
GROUP BY l.source,date_trunc('month',l.created_at)::date,sas.amount;

ALTER VIEW public.stage_aging_summary SET (security_invoker = true); -- lint-allow: staff analytics intentionally obey caller lead RLS for exact authorized scopes.
ALTER VIEW public.source_funnel SET (security_invoker = true); -- lint-allow: staff analytics intentionally obey caller lead RLS for exact authorized scopes.
ALTER VIEW public.source_roi_summary SET (security_invoker = true); -- lint-allow: staff analytics intentionally obey caller lead RLS for exact authorized scopes.
GRANT SELECT ON public.stage_aging_summary, public.source_funnel, public.source_roi_summary TO authenticated;
