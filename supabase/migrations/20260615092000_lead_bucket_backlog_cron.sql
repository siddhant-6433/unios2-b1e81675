-- TL backlog notification: unassigned leads in the bucket are pinged to
-- team leaders + admission heads on a cadence so paid acquisition doesn't
-- decay while waiting for a counsellor assignment.
--
-- Thresholds per source tier (paid leads decay fastest):
--   meta_ads, google_ads   → 30 minutes
--   website, mirai_website → 2 hours
--   all other sources      → 4 hours
--
-- Recipients: every user who is either a team leader (teams.leader_id) or
-- holds one of the supervisory roles (super_admin / campus_admin /
-- admission_head). De-dup: one notification per (recipient, alert_key) per
-- hour — so a persistent backlog re-notifies every hour, not every cron
-- tick.

-- 1. Allow the new notification type.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'lead_assigned', 'sla_warning', 'lead_reclaimed',
    'followup_due', 'followup_overdue', 'visit_confirmation_due',
    'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
    'whatsapp_message', 'approval_pending', 'approval_decided',
    'tat_defaults_report', 'post_visit_nudge', 'score_penalty',
    'lead_bucket_backlog',
    -- Legacy types found in production data when this migration was first
    -- applied — preserved so the CHECK doesn't reject existing rows.
    'visit_due', 'missed_call', 'callback_requested'
  ));

-- 2. Cooldown / de-dup table. alert_key encodes bucket + source_tier
-- (e.g. "school-paid", "college-website") so different bucket+tier
-- combinations alert independently.
CREATE TABLE IF NOT EXISTS public.lead_bucket_backlog_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_key         text NOT NULL,
  pending_count     integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_bucket_backlog_alerts_recipient_key_idx
  ON public.lead_bucket_backlog_alerts (recipient_user_id, alert_key, created_at DESC);

ALTER TABLE public.lead_bucket_backlog_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_bucket_backlog_alerts_read ON public.lead_bucket_backlog_alerts;
CREATE POLICY lead_bucket_backlog_alerts_read
  ON public.lead_bucket_backlog_alerts FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

-- 3. Schedule the cron. Every 30 minutes between 9 AM and 8 PM IST (=
-- 3:30 to 14:30 UTC), Mon-Sat. The paid threshold is 30 min so a
-- 30-min cadence catches them before the first hour of decay.
SELECT cron.schedule(
  'lead-bucket-backlog',
  '0,30 3-14 * * 1-6',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/lead-bucket-backlog-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
