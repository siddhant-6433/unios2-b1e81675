-- Backfill counsellor scores from all historical data
-- Excludes: system-generated entries, bulk operations

-- Clear any existing (they were already wiped, but be safe)
TRUNCATE public.counsellor_score_events;

-- ============================================================
-- 1. CALL LOGS — Score every manual call by a counsellor
-- ============================================================

-- 1a. First contact calls (first call ever made to a lead)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cl.lead_id,
  CASE
    WHEN cl.called_at::date = l.created_at::date THEN 'first_contact_same_day'
    ELSE 'first_contact'
  END,
  CASE
    WHEN cl.called_at::date = l.created_at::date THEN 15  -- Same day bonus
    ELSE 8
  END,
  jsonb_build_object('disposition', cl.disposition, 'backfilled', true),
  cl.called_at
FROM public.call_logs cl
JOIN public.leads l ON l.id = cl.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cl.user_id IS NOT NULL  -- Exclude system/AI calls
  AND cl.id = (
    -- Only the FIRST call to each lead
    SELECT c2.id FROM public.call_logs c2
    WHERE c2.lead_id = cl.lead_id AND c2.user_id IS NOT NULL
    ORDER BY c2.called_at ASC LIMIT 1
  );

-- 1b. All calls — disposition-based scoring
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cl.lead_id,
  'call_made',
  CASE cl.disposition
    WHEN 'interested' THEN 10
    WHEN 'call_back' THEN 5
    WHEN 'not_answered' THEN 2
    WHEN 'busy' THEN 2
    WHEN 'voicemail' THEN 2
    ELSE 1  -- Any call is work
  END,
  jsonb_build_object('disposition', cl.disposition, 'duration', COALESCE(cl.duration_seconds, 0), 'backfilled', true),
  cl.called_at
FROM public.call_logs cl
JOIN public.leads l ON l.id = cl.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cl.user_id IS NOT NULL  -- Exclude system/AI calls
  AND cl.disposition IS NOT NULL
  AND cl.disposition NOT IN ('not_interested', 'do_not_contact', 'wrong_number', 'ineligible');  -- Neutral outcomes

-- 1c. Quality call bonus (calls > 2 minutes)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cl.lead_id,
  'quality_call',
  5,
  jsonb_build_object('duration', cl.duration_seconds, 'backfilled', true),
  cl.called_at
FROM public.call_logs cl
JOIN public.leads l ON l.id = cl.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cl.user_id IS NOT NULL
  AND cl.duration_seconds >= 120;

-- ============================================================
-- 2. CAMPUS VISITS — Score scheduled, completed, walk-ins
-- ============================================================

-- 2a. Scheduled visits
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cv.lead_id,
  'visit_scheduled',
  8,
  jsonb_build_object('backfilled', true),
  cv.created_at
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND COALESCE(cv.visit_type, 'scheduled') = 'scheduled';

-- 2b. Completed visits (scheduled type only — walk-ins scored separately)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cv.lead_id,
  'visit_completed',
  15,
  jsonb_build_object('backfilled', true),
  COALESCE(cv.updated_at, cv.created_at)
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cv.status = 'completed'
  AND COALESCE(cv.visit_type, 'scheduled') = 'scheduled';

-- 2c. Walk-in visits (already completed on creation)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cv.lead_id,
  'walk_in_recorded',
  20,
  jsonb_build_object('backfilled', true),
  cv.created_at
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cv.visit_type = 'walk_in';

-- 2d. No-show visits
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  cv.lead_id,
  'visit_no_show',
  -5,
  jsonb_build_object('backfilled', true),
  COALESCE(cv.updated_at, cv.created_at)
FROM public.campus_visits cv
JOIN public.leads l ON l.id = cv.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND cv.status = 'no_show';

-- ============================================================
-- 3. LEAD FOLLOWUPS — Score completed followups
-- ============================================================

-- 3a. On-time followups (completed within 24h of scheduled)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  lf.lead_id,
  'followup_on_time',
  5,
  jsonb_build_object('type', lf.type, 'backfilled', true),
  lf.completed_at
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND lf.status = 'completed'
  AND lf.completed_at IS NOT NULL
  AND lf.completed_at <= lf.scheduled_at + interval '24 hours';

-- 3b. Late followups (completed but after 24h)
INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  lf.lead_id,
  'followup_late',
  2,
  jsonb_build_object('type', lf.type, 'backfilled', true),
  lf.completed_at
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND lf.status = 'completed'
  AND lf.completed_at IS NOT NULL
  AND lf.completed_at > lf.scheduled_at + interval '24 hours';

-- ============================================================
-- 4. STAGE TRANSITIONS — Score high-value stage advances
--    Using lead_activities to get historical transitions
-- ============================================================

INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata, created_at)
SELECT
  l.counsellor_id,
  la.lead_id,
  'stage_advance',
  CASE la.new_stage::text
    WHEN 'visit_scheduled' THEN 5
    WHEN 'offer_sent' THEN 15
    WHEN 'token_paid' THEN 25
    WHEN 'admitted' THEN 50
    ELSE 0
  END,
  jsonb_build_object('from_stage', la.old_stage::text, 'to_stage', la.new_stage::text, 'backfilled', true),
  la.created_at
FROM public.lead_activities la
JOIN public.leads l ON l.id = la.lead_id
WHERE l.counsellor_id IS NOT NULL
  AND la.type IN ('status_change', 'stage_change')
  AND la.new_stage IS NOT NULL
  AND la.new_stage::text IN ('visit_scheduled', 'offer_sent', 'token_paid', 'admitted')
  -- Exclude system-generated stage changes (user_id should be set for manual changes)
  AND la.user_id IS NOT NULL;
