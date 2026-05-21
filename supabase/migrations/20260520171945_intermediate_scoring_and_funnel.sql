-- Intermediate-win scoring + per-counsellor funnel visibility.
--
-- The existing fn_record_counsellor_score (migration 20260417100000) awards
-- points for application_in_progress, offer_sent, token_paid, admitted,
-- rejected, not_interested — but transitions to visit_scheduled, interview,
-- and pre_admitted go uncounted. A counsellor who pushes 20 leads to
-- 'interview' but closes 0 admissions looks identical to one who never tried.
--
-- This migration adds two things:
--   1. A supplementary trigger that ONLY scores the missing intermediate stages.
--      Layered as a separate trigger so we don't have to re-CREATE OR REPLACE
--      the long-form existing function (lower blast radius if anything goes wrong).
--   2. counsellor_funnel_stats view — per counsellor per week, count of distinct
--      leads transitioned into each stage. The frontend computes drop-off rates
--      between adjacent stages.

-- ── 1. Intermediate-win scoring ────────────────────────────────────────────

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

  -- Only intermediate stages the existing fn_record_counsellor_score skips.
  -- Stay strictly disjoint from that function to avoid double-counting.
  v_points := CASE NEW.stage::text
    WHEN 'visit_scheduled' THEN 5
    WHEN 'interview'       THEN 10
    WHEN 'pre_admitted'    THEN 30
    ELSE 0
  END;

  IF v_points <> 0 THEN
    INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
    VALUES (NEW.counsellor_id, NEW.id, 'stage_change_intermediate', v_points,
      jsonb_build_object('from_stage', OLD.stage::text, 'to_stage', NEW.stage::text));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_intermediate_stage_change ON public.leads;
CREATE TRIGGER trg_score_intermediate_stage_change
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_score_intermediate_stage_change();

-- ── 2. Per-counsellor funnel view ──────────────────────────────────────────
--
-- Reads from lead_activities (the canonical activity log). Counts distinct
-- leads that transitioned INTO a given stage, attributed to the counsellor
-- (lead_activities.user_id is the profile id of the actor). Weekly grain in
-- IST so dashboards align with the counsellor's working week.
--
-- The frontend computes drop-off as count(stage_n+1) / count(stage_n) using
-- the natural stage ordering: new_lead → ai_called → counsellor_call →
-- application_in_progress → visit_scheduled → interview → offer_sent →
-- token_paid → pre_admitted → admitted.

CREATE OR REPLACE VIEW public.counsellor_funnel_stats AS
SELECT
  p.id                                                                AS counsellor_id,
  p.display_name                                                       AS counsellor_name,
  a.new_stage::text                                                    AS stage,
  (date_trunc('week', (a.created_at AT TIME ZONE 'Asia/Kolkata')))::date AS week_start,
  COUNT(DISTINCT a.lead_id)                                            AS leads_reached
FROM public.lead_activities a
JOIN public.profiles p ON p.id = a.user_id
WHERE a.type IN ('status_change', 'stage_change')
  AND a.new_stage IS NOT NULL
  AND a.user_id IS NOT NULL
GROUP BY p.id, p.display_name, a.new_stage, week_start;

GRANT SELECT ON public.counsellor_funnel_stats TO authenticated;

COMMENT ON VIEW public.counsellor_funnel_stats IS
  'Per-counsellor per-week count of distinct leads that transitioned into each stage. Used by CounsellorDashboard to compute adjacent-stage conversion rates and surface where each counsellor leaks the funnel.';
