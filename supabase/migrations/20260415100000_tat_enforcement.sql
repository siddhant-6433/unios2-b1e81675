-- TAT (Turnaround Time) Enforcement System
-- 1. Fix not_interested exclusion in all SLA views
-- 2. Application check-in intervals
-- 3. Counsellor defaults view
-- 4. Team leader defaults summary
-- 5. Auto-cancel follow-ups when lead is not_interested
-- 6. Performance indexes

-- =====================================================
-- 1. Fix not_interested exclusion in existing views
-- =====================================================

-- Recreate inactive_leads view
DROP VIEW IF EXISTS public.inactive_leads CASCADE;
CREATE VIEW public.inactive_leads AS
SELECT l.id, l.name, l.phone, l.stage, l.counsellor_id,
       l.updated_at AS last_activity,
       EXTRACT(EPOCH FROM (now() - l.updated_at)) / 86400 AS inactive_days,
       sit.max_inactive_days
FROM public.leads l
JOIN public.stage_inactivity_thresholds sit ON sit.stage = l.stage::text
WHERE l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  AND l.counsellor_id IS NOT NULL
  AND EXTRACT(EPOCH FROM (now() - l.updated_at)) / 86400 > sit.max_inactive_days;

-- Recreate SLA breached leads view
DROP VIEW IF EXISTS public.sla_breached_leads CASCADE;
CREATE VIEW public.sla_breached_leads AS
SELECT l.id, l.name, l.phone, l.stage, l.counsellor_id,
       l.assigned_at,
       EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 AS hours_since_assigned,
       sc.first_contact_hours AS sla_hours
FROM public.leads l
JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
WHERE l.counsellor_id IS NOT NULL
  AND l.first_contact_at IS NULL
  AND l.assigned_at IS NOT NULL
  AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours;

-- =====================================================
-- 2. Application check-in intervals
-- =====================================================

ALTER TABLE public.stage_sla_config
  ADD COLUMN IF NOT EXISTS checkin_interval_hours integer,
  ADD COLUMN IF NOT EXISTS checkin_warning_hours integer;

-- Application in progress: check in every 48 hours
UPDATE public.stage_sla_config
SET checkin_interval_hours = 48, checkin_warning_hours = 40
WHERE stage = 'application_in_progress';

-- Application submitted: check in every 72 hours
UPDATE public.stage_sla_config
SET checkin_interval_hours = 72, checkin_warning_hours = 60
WHERE stage = 'application_submitted';

-- Application fee paid: check in every 48 hours
UPDATE public.stage_sla_config
SET checkin_interval_hours = 48, checkin_warning_hours = 40
WHERE stage = 'application_fee_paid';

-- =====================================================
-- 3. Counsellor TAT defaults view
-- =====================================================

CREATE OR REPLACE VIEW public.counsellor_tat_defaults AS
WITH counsellors AS (
  SELECT p.id AS profile_id, p.user_id, p.display_name, p.phone
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'counsellor'
),
-- New leads not contacted within SLA
sla_breaches AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.first_contact_at IS NULL
    AND l.assigned_at IS NOT NULL
    AND l.counsellor_id IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - l.assigned_at)) / 3600 > sc.first_contact_hours
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  GROUP BY l.counsellor_id
),
-- Overdue follow-ups
overdue_fups AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.lead_followups lf
  JOIN public.leads l ON l.id = lf.lead_id
  WHERE lf.status = 'pending'
    AND lf.scheduled_at < now()
    AND l.counsellor_id IS NOT NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  GROUP BY l.counsellor_id
),
-- Application check-in overdue (no activity within checkin_interval_hours)
app_checkins AS (
  SELECT l.counsellor_id AS profile_id, COUNT(*) AS cnt
  FROM public.leads l
  JOIN public.stage_sla_config sc ON sc.stage = l.stage::text
  WHERE l.counsellor_id IS NOT NULL
    AND sc.checkin_interval_hours IS NOT NULL
    AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_activities la
      WHERE la.lead_id = l.id
        AND la.created_at > now() - make_interval(hours => sc.checkin_interval_hours)
    )
  GROUP BY l.counsellor_id
)
SELECT
  c.profile_id,
  c.user_id,
  c.display_name AS counsellor_name,
  c.phone AS counsellor_phone,
  COALESCE(sb.cnt, 0)::int AS new_leads_overdue,
  COALESCE(ofu.cnt, 0)::int AS overdue_followups,
  COALESCE(ac.cnt, 0)::int AS app_checkins_overdue,
  (COALESCE(sb.cnt, 0) + COALESCE(ofu.cnt, 0) + COALESCE(ac.cnt, 0))::int AS total_defaults
FROM counsellors c
LEFT JOIN sla_breaches sb ON sb.profile_id = c.profile_id
LEFT JOIN overdue_fups ofu ON ofu.profile_id = c.profile_id
LEFT JOIN app_checkins ac ON ac.profile_id = c.profile_id;

GRANT SELECT ON public.counsellor_tat_defaults TO authenticated;

-- =====================================================
-- 4. Team leader defaults summary
-- =====================================================

CREATE OR REPLACE VIEW public.team_leader_defaults_summary AS
SELECT
  t.id AS team_id,
  t.name AS team_name,
  t.leader_id AS leader_profile_id,
  lp.user_id AS leader_user_id,
  lp.display_name AS leader_name,
  lp.phone AS leader_phone,
  ctd.profile_id AS counsellor_profile_id,
  ctd.counsellor_name,
  ctd.new_leads_overdue,
  ctd.overdue_followups,
  ctd.app_checkins_overdue,
  ctd.total_defaults
FROM public.teams t
JOIN public.profiles lp ON lp.id = t.leader_id
JOIN public.team_members tm ON tm.team_id = t.id
JOIN public.profiles mp ON mp.user_id = tm.user_id
JOIN public.counsellor_tat_defaults ctd ON ctd.profile_id = mp.id
WHERE ctd.total_defaults > 0;

GRANT SELECT ON public.team_leader_defaults_summary TO authenticated;

-- =====================================================
-- 5. Auto-cancel follow-ups when lead marked not_interested
-- =====================================================

CREATE OR REPLACE FUNCTION public.fn_cancel_followups_on_not_interested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'not_interested' AND OLD.stage IS DISTINCT FROM 'not_interested' THEN
    UPDATE public.lead_followups
    SET status = 'cancelled'
    WHERE lead_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_followups_not_interested ON public.leads;
CREATE TRIGGER trg_cancel_followups_not_interested
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (NEW.stage = 'not_interested')
  EXECUTE FUNCTION public.fn_cancel_followups_on_not_interested();

-- =====================================================
-- 6. Performance indexes
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_leads_counsellor_stage_active
  ON public.leads(counsellor_id, stage)
  WHERE stage NOT IN ('admitted', 'rejected', 'not_interested');

CREATE INDEX IF NOT EXISTS idx_lead_activities_recent
  ON public.lead_activities(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_followups_pending
  ON public.lead_followups(lead_id, status, scheduled_at)
  WHERE status = 'pending';

-- =====================================================
-- 7. Notification type update
-- =====================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned', 'sla_warning', 'lead_reclaimed',
  'followup_due', 'followup_overdue', 'visit_confirmation_due',
  'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
  'whatsapp_message', 'approval_pending', 'approval_decided',
  'tat_defaults_report'
));
