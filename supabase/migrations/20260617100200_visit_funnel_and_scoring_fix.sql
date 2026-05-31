-- PR1 Visit track — lead-centric Visit funnel source + scoring-farm fix.

-- ── 1. Indexes supporting the funnel + latest-visit lookup ──────────────────
CREATE INDEX IF NOT EXISTS idx_campus_visits_lead_date
  ON public.campus_visits (lead_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_campus_visits_status
  ON public.campus_visits (status);

-- ── 2. Visit funnel — ONE row per visited lead, at its furthest box ─────────
-- D11: lead-centric, deduped to the latest campus_visit (a reschedule shows as
-- Scheduled, not stuck No-show; repeat visits don't double-count). Applied/
-- Admitted are presence overlays from the lead's lifecycle (D10 presence-based)
-- and supersede the visit-status boxes. The dashboard counts by funnel_box;
-- click-to-filter selects lead_ids where funnel_box = X.
CREATE OR REPLACE VIEW public.visit_funnel_leads
WITH (security_invoker = on) AS
WITH latest_visit AS (
  SELECT DISTINCT ON (cv.lead_id)
         cv.lead_id,
         cv.id          AS visit_id,
         cv.status      AS visit_status,
         cv.visit_date
    FROM public.campus_visits cv
   ORDER BY cv.lead_id, cv.visit_date DESC, cv.created_at DESC
)
SELECT
  lv.lead_id,
  l.counsellor_id,
  lv.visit_status,
  lv.visit_date,
  CASE
    WHEN l.admitted_at IS NOT NULL OR l.stage = 'admitted'              THEN 'admitted'
    WHEN l.applied_at IS NOT NULL                                       THEN 'applied'
    WHEN lv.visit_status = 'completed'
         AND EXISTS (SELECT 1 FROM public.lead_followups f
                      WHERE f.visit_id = lv.visit_id AND f.status = 'pending')
                                                                        THEN 'visit_followup'
    WHEN lv.visit_status = 'completed'                                  THEN 'completed'
    WHEN lv.visit_status = 'confirmed'                                  THEN 'confirmed'
    WHEN lv.visit_status = 'scheduled'                                  THEN 'scheduled'
    WHEN lv.visit_status IN ('no_show','cancelled')                     THEN 'leakage'
    ELSE 'leakage'
  END AS funnel_box
FROM latest_visit lv
JOIN public.leads l ON l.id = lv.lead_id;

GRANT SELECT ON public.visit_funnel_leads TO authenticated, service_role;

COMMENT ON VIEW public.visit_funnel_leads IS
  'One row per lead that has any campus_visit, assigned to its furthest Visit-funnel box (latest visit status, with Applied/Admitted presence overlays). Drives VisitPipeline counts + click-to-filter. funnel_box in: scheduled, confirmed, completed, visit_followup, applied, admitted, leakage.';

-- ── 3. Scoring-farm fix ─────────────────────────────────────────────────────
-- PendingFollowups re-sets a lead to visit_scheduled on every reschedule/no-show,
-- and fn_score_intermediate_stage_change awarded 5 pts on each transition INTO
-- visit_scheduled — so rescheduling farmed points. Award each intermediate
-- stage's points AT MOST ONCE per lead (a lead legitimately reaches each
-- forward stage once).
CREATE OR REPLACE FUNCTION public.fn_score_intermediate_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
BEGIN
  IF NEW.counsellor_id IS NULL THEN RETURN NEW; END IF;
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN RETURN NEW; END IF;

  v_points := CASE NEW.stage::text
    WHEN 'visit_scheduled' THEN 5
    WHEN 'interview'       THEN 10
    WHEN 'pre_admitted'    THEN 30
    ELSE 0
  END;

  IF v_points <> 0 THEN
    -- Once-per-lead-per-target: skip if this lead was already scored for
    -- reaching this stage (prevents reschedule farming on visit_scheduled).
    IF NOT EXISTS (
      SELECT 1 FROM public.counsellor_score_events e
       WHERE e.lead_id = NEW.id
         AND e.action_type = 'stage_change_intermediate'
         AND e.metadata->>'to_stage' = NEW.stage::text
    ) THEN
      INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
      VALUES (NEW.counsellor_id, NEW.id, 'stage_change_intermediate', v_points,
        jsonb_build_object('from_stage', OLD.stage::text, 'to_stage', NEW.stage::text));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
