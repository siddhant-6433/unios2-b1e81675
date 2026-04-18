-- Phase 2: Post-Visit Nudge System + Daily Score Penalties

-- 1. Add post_visit_nudge to notification type constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'lead_assigned', 'sla_warning', 'lead_reclaimed',
    'followup_due', 'followup_overdue', 'visit_confirmation_due',
    'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
    'whatsapp_message', 'approval_pending', 'approval_decided',
    'tat_defaults_report', 'post_visit_nudge', 'score_penalty'
  ));

-- 2. Nudge tracking table (dedup: one nudge per tier per visit)
CREATE TABLE public.visit_followup_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier integer NOT NULL, -- 1=4h, 2=24h, 3=48h, 4=72h, 5=5d
  notified_at timestamptz DEFAULT now(),
  UNIQUE(visit_id, tier)
);

CREATE INDEX idx_nudge_visit ON public.visit_followup_nudges(visit_id);
ALTER TABLE public.visit_followup_nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read nudges" ON public.visit_followup_nudges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can insert nudges" ON public.visit_followup_nudges
  FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Daily score penalty dedup table
CREATE TABLE public.score_penalty_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  penalty_type text NOT NULL, -- 'followup_overdue', 'inactive_lead', 'post_visit_overdue'
  penalty_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(counsellor_id, lead_id, penalty_type, penalty_date)
);

ALTER TABLE public.score_penalty_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read penalties" ON public.score_penalty_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can insert penalties" ON public.score_penalty_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 4. Post-visit pipeline summary view (for team leader dashboard)
CREATE OR REPLACE VIEW public.post_visit_pipeline AS
SELECT
  l.counsellor_id,
  p.display_name AS counsellor_name,
  COUNT(*) FILTER (WHERE pv.days_since_visit <= 7) AS visited_7d,
  COUNT(*) FILTER (WHERE pv.days_since_visit <= 7 AND EXISTS (
    SELECT 1 FROM public.call_logs cl WHERE cl.lead_id = pv.lead_id AND cl.called_at > pv.visit_date
  )) AS followed_up_7d,
  COUNT(*) AS pending_total,
  ROUND(AVG(pv.days_since_visit), 1) AS avg_days_pending
FROM public.post_visit_pending_followups pv
JOIN public.leads l ON l.id = pv.lead_id
JOIN public.profiles p ON p.id = l.counsellor_id
GROUP BY l.counsellor_id, p.display_name;

GRANT SELECT ON public.post_visit_pipeline TO authenticated;

-- 5. Schedule post-visit nudge cron (every 2 hours during business hours IST)
SELECT cron.schedule(
  'post-visit-nudge',
  '0 4,6,8,10,12 * * 1-6',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/post-visit-nudge-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- 6. Schedule daily score penalty cron (once daily at 10pm IST = 4:30pm UTC)
SELECT cron.schedule(
  'counsellor-score-penalties',
  '30 16 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/counsellor-score-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
