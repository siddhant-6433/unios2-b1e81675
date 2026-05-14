-- SLA auto-reclaim: leads assigned to a counsellor but never contacted within
-- their source's first-contact window are auto-unassigned back to the bucket.
-- Prevents hoarding and gets time-sensitive leads to whoever can actually call.
--
-- Builds on existing infrastructure:
--   leads.assigned_at, leads.first_contact_at, leads.auto_returned_count
--   notifications.type accepts 'lead_reclaimed'
--   counsellor_score_events.action_type is free text

-- 1. Source SLA config — per-source first-contact window in hours.
--    Real-time intent sources get 4h; bulk publisher dumps get 24h; offline
--    sources (walk-in, fair, consultant, referral) get 48h.
CREATE TABLE IF NOT EXISTS public.source_sla_config (
  source text PRIMARY KEY,
  first_contact_hours integer NOT NULL CHECK (first_contact_hours > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.source_sla_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read source SLA"
  ON public.source_sla_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage source SLA"
  ON public.source_sla_config FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'campus_admin'::app_role)
    OR public.has_role(auth.uid(), 'admission_head'::app_role)
  );

INSERT INTO public.source_sla_config (source, first_contact_hours) VALUES
  -- Real-time intent (4h): person just expressed interest, call within the hour
  ('website',        4),
  ('website_chat',   4),
  ('meta_ads',       4),
  ('google_ads',     4),
  ('enquiry',        4),
  ('inbound_call',   4),
  ('whatsapp',       4),
  -- Bulk publishers (24h): leads dumped in batches, less time-sensitive
  ('shiksha',       24),
  ('justdial',      24),
  ('collegedunia',  24),
  ('collegehai',    24),
  ('salahlo',       24),
  ('mirai_website', 24),
  ('other',         24),
  -- Offline / human-touched (48h): counsellor has more context, less urgent
  ('walk_in',        48),
  ('direct_walkin',  48),
  ('education_fair', 48),
  ('consultant',     48),
  ('referral',       48)
ON CONFLICT (source) DO NOTHING;

-- 2. Auto-reclaim function. Scans leads that are assigned, never contacted,
--    still in an early stage, past their SLA, and unassigns them. Logs a
--    negative score event and notifies the (former) counsellor.
--
--    Returns count of reclaimed leads — useful for cron observability.
CREATE OR REPLACE FUNCTION public.fn_reclaim_overdue_leads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r record;
  v_window int;
  v_user_id uuid;
BEGIN
  FOR r IN
    SELECT
      l.id,
      l.counsellor_id,
      l.assigned_at,
      l.source::text AS source,
      l.name AS lead_name,
      COALESCE(s.first_contact_hours, 24) AS window_h
    FROM public.leads l
    LEFT JOIN public.source_sla_config s ON s.source = l.source::text
    WHERE l.counsellor_id IS NOT NULL
      AND l.assigned_at IS NOT NULL
      AND l.first_contact_at IS NULL
      AND l.stage IN ('new_lead'::lead_stage, 'ai_called'::lead_stage)
      AND l.assigned_at + (COALESCE(s.first_contact_hours, 24) || ' hours')::interval < now()
  LOOP
    v_window := r.window_h;

    -- Capture the counsellor's auth user_id for the notification before we
    -- null out the assignment.
    SELECT user_id INTO v_user_id FROM public.profiles WHERE id = r.counsellor_id;

    -- Unassign. The fn_lead_assignment_tracker trigger will clear assigned_at.
    UPDATE public.leads
    SET counsellor_id = NULL,
        auto_returned_count = COALESCE(auto_returned_count, 0) + 1
    WHERE id = r.id;

    v_count := v_count + 1;

    -- Negative score event so leaderboards reflect the miss.
    INSERT INTO public.counsellor_score_events (counsellor_id, lead_id, action_type, points, metadata)
    VALUES (r.counsellor_id, r.id, 'sla_reclaim', -5,
            jsonb_build_object(
              'window_hours', v_window,
              'source', r.source,
              'assigned_at', r.assigned_at
            ));

    -- Notify the (former) counsellor so they know why the lead vanished.
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        v_user_id,
        'lead_reclaimed',
        'Lead returned to bucket',
        format('%s was unassigned after %s hours with no contact. Anyone in the team can now claim it.', r.lead_name, v_window),
        '/lead-buckets',
        r.id
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reclaim_overdue_leads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_reclaim_overdue_leads() TO authenticated, service_role;

-- 3. Schedule every 15 minutes. The function is idempotent — if a lead is
--    contacted between runs it's no longer eligible.
SELECT cron.schedule(
  'sla-auto-reclaim',
  '*/15 * * * *',
  $$SELECT public.fn_reclaim_overdue_leads()$$
);
