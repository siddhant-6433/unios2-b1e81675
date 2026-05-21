-- Single RPC that returns every count rendered on the Admissions dashboard.
-- Replaces 14+ parallel client queries with one round-trip.
--
-- Scoping:
--   p_counsellor_id IS NOT NULL  → counsellor view (limits all counts to that counsellor's leads)
--   p_counsellor_id IS NULL AND p_campus_id IS NOT NULL → admin/campus view
--   both NULL → org-wide (super_admin / admission_head viewing all campuses)

CREATE OR REPLACE FUNCTION public.admissions_stats(
  p_counsellor_id uuid DEFAULT NULL,
  p_campus_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  today_start timestamptz := date_trunc('day', now());
  today_end   timestamptz := today_start + interval '1 day';

  v_new_leads        integer;
  v_today_leads      integer;
  v_app_started      integer;
  v_app_submitted    integer;
  v_admitted         integer;
  v_fee_paid         integer;
  v_offer_sent       integer;
  v_token_paid       integer;
  v_pre_admitted     integer;
  v_pending_fu       integer;
  v_today_fu         integer;
  v_overdue_fu       integer;
  v_upcoming_visits  integer;
  v_completed_visits integer;
  v_post_visit_ids   jsonb;
BEGIN
  -- Stage counts. Mirror leads are excluded so school + main session aren't double-counted.
  -- A single scan with FILTER clauses is dramatically cheaper than 9 separate count(*) queries.
  SELECT
    count(*) FILTER (WHERE stage = 'new_lead'),
    count(*) FILTER (WHERE created_at >= today_start AND created_at < today_end),
    count(*) FILTER (WHERE stage IN ('application_in_progress','application_fee_paid','application_submitted','offer_sent','token_paid','pre_admitted')),
    count(*) FILTER (WHERE stage IN ('application_submitted','offer_sent','token_paid','pre_admitted')),
    count(*) FILTER (WHERE stage = 'admitted'),
    count(*) FILTER (WHERE stage = 'offer_sent'),
    count(*) FILTER (WHERE stage = 'token_paid'),
    count(*) FILTER (WHERE stage = 'pre_admitted')
  INTO
    v_new_leads, v_today_leads, v_app_started, v_app_submitted,
    v_admitted, v_offer_sent, v_token_paid, v_pre_admitted
  FROM public.leads l
  WHERE l.is_mirror = false
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id);

  -- Fee paid: distinct leads where either (a) stage is in fee-paid stages,
  -- or (b) an application row has payment_status = 'paid'. Same scope as above.
  SELECT count(DISTINCT l.id)
  INTO v_fee_paid
  FROM public.leads l
  LEFT JOIN public.applications a ON a.lead_id = l.id AND a.payment_status = 'paid'
  WHERE l.is_mirror = false
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id)
    AND (
      l.stage IN ('application_fee_paid','application_submitted','offer_sent','token_paid','pre_admitted','admitted')
      OR a.id IS NOT NULL
    );

  -- Followup counts — scoped via join to leads when filtering by counsellor/campus
  SELECT
    count(*) FILTER (WHERE lf.status = 'pending'),
    count(*) FILTER (WHERE lf.status = 'pending' AND lf.scheduled_at >= today_start AND lf.scheduled_at < today_end),
    count(*) FILTER (WHERE lf.status = 'pending' AND lf.scheduled_at < now()
                       AND l.stage NOT IN ('not_interested','dnc','rejected','ineligible'))
  INTO v_pending_fu, v_today_fu, v_overdue_fu
  FROM public.lead_followups lf
  JOIN public.leads l ON l.id = lf.lead_id
  WHERE l.is_mirror = false
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id);

  -- Visit counts — distinct lead_id (matches existing client logic)
  SELECT
    count(DISTINCT cv.lead_id) FILTER (WHERE cv.visit_date >= today_start AND cv.status IN ('scheduled','confirmed')),
    count(DISTINCT cv.lead_id) FILTER (WHERE cv.status = 'completed')
  INTO v_upcoming_visits, v_completed_visits
  FROM public.campus_visits cv
  JOIN public.leads l ON l.id = cv.lead_id
  WHERE l.is_mirror = false
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id);

  -- Post-visit pending lead IDs (used for visual indicators on each row)
  SELECT COALESCE(jsonb_agg(DISTINCT pv.lead_id), '[]'::jsonb)
  INTO v_post_visit_ids
  FROM public.post_visit_pending_followups pv
  JOIN public.leads l ON l.id = pv.lead_id
  WHERE l.is_mirror = false
    AND (p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id)
    AND (p_counsellor_id IS NOT NULL OR p_campus_id IS NULL OR l.campus_id = p_campus_id);

  RETURN jsonb_build_object(
    'new_leads',         v_new_leads,
    'today_leads',       v_today_leads,
    'app_started',       v_app_started,
    'app_submitted',     v_app_submitted,
    'admitted',          v_admitted,
    'fee_paid',          v_fee_paid,
    'offer_sent',        v_offer_sent,
    'token_paid',        v_token_paid,
    'pre_admitted',      v_pre_admitted,
    'pending_followups', v_pending_fu,
    'today_followups',   v_today_fu,
    'overdue_followups', v_overdue_fu,
    'upcoming_visits',   v_upcoming_visits,
    'completed_visits',  v_completed_visits,
    'post_visit_pending_lead_ids', v_post_visit_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admissions_stats(uuid, uuid) TO authenticated;

-- Supporting indexes for the new scan-once pattern.
-- The Admissions dashboard is overwhelmingly the hottest read path, and these
-- composite indexes turn the filtered count(*) calls above into index-only scans.
CREATE INDEX IF NOT EXISTS idx_leads_stage_active
  ON public.leads (stage)
  WHERE is_mirror = false;

CREATE INDEX IF NOT EXISTS idx_leads_campus_created
  ON public.leads (campus_id, created_at DESC)
  WHERE is_mirror = false;

CREATE INDEX IF NOT EXISTS idx_leads_counsellor_created
  ON public.leads (counsellor_id, created_at DESC)
  WHERE is_mirror = false;

CREATE INDEX IF NOT EXISTS idx_applications_paid
  ON public.applications (lead_id)
  WHERE payment_status = 'paid';

CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_status
  ON public.lead_followups (lead_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_campus_visits_lead_status
  ON public.campus_visits (lead_id, status, visit_date);
