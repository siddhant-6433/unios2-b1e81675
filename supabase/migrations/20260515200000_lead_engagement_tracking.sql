-- Migration: Lead Engagement Tracking
-- Tracks website/email engagement events per lead and computes an engagement_score.

-- 1. Create lead_engagement_events table
CREATE TABLE public.lead_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  phone text,
  event_type text NOT NULL,
  page_url text,
  referrer text,
  metadata jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  session_id text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.lead_engagement_events IS 'Tracks website and email engagement events per lead';
COMMENT ON COLUMN public.lead_engagement_events.phone IS 'Fallback when lead_id unknown, normalized +91XXXXXXXXXX';
COMMENT ON COLUMN public.lead_engagement_events.event_type IS 'page_view, chat_open, chat_message, navya_click, whatsapp_click, email_open, form_start, apply_click';
COMMENT ON COLUMN public.lead_engagement_events.session_id IS 'Browser session grouping';

-- Disable RLS (append-only tracking table, inserts come from edge function + internal)
ALTER TABLE public.lead_engagement_events DISABLE ROW LEVEL SECURITY;

-- Grant access to all roles
GRANT ALL ON public.lead_engagement_events TO anon;
GRANT ALL ON public.lead_engagement_events TO authenticated;
GRANT ALL ON public.lead_engagement_events TO service_role;

-- Indexes
CREATE INDEX idx_engagement_events_lead_id ON public.lead_engagement_events (lead_id);
CREATE INDEX idx_engagement_events_phone ON public.lead_engagement_events (phone);
CREATE INDEX idx_engagement_events_event_type ON public.lead_engagement_events (event_type);
CREATE INDEX idx_engagement_events_created_at ON public.lead_engagement_events (created_at);
CREATE INDEX idx_engagement_events_created_at_desc ON public.lead_engagement_events (created_at DESC);

-- 2. Add engagement_score and last_engaged_at columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS engagement_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_engaged_at timestamptz;

COMMENT ON COLUMN public.leads.engagement_score IS 'Website/email engagement score (0-100), separate from lead_score which tracks pipeline progress';
COMMENT ON COLUMN public.leads.last_engaged_at IS 'Timestamp of the most recent engagement event';

-- 3. Create trigger function
CREATE OR REPLACE FUNCTION public.update_lead_engagement_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lead_id uuid;
  v_score_delta integer;
BEGIN
  v_lead_id := NEW.lead_id;

  -- If lead_id is not set but phone is, try to find the lead by phone
  IF v_lead_id IS NULL AND NEW.phone IS NOT NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE phone = NEW.phone
    LIMIT 1;

    -- Backfill lead_id on the event row
    IF v_lead_id IS NOT NULL THEN
      UPDATE public.lead_engagement_events
      SET lead_id = v_lead_id
      WHERE id = NEW.id;
    END IF;
  END IF;

  -- If we still have no lead, nothing to update
  IF v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine score weight based on event_type
  v_score_delta := CASE NEW.event_type
    WHEN 'page_view'      THEN 1
    WHEN 'chat_open'       THEN 3
    WHEN 'chat_message'    THEN 5
    WHEN 'navya_click'     THEN 5
    WHEN 'whatsapp_click'  THEN 4
    WHEN 'email_open'      THEN 3
    WHEN 'form_start'      THEN 4
    WHEN 'apply_click'     THEN 8
    ELSE 0
  END;

  -- Update the lead's engagement_score (capped at 100) and last_engaged_at
  UPDATE public.leads
  SET
    engagement_score = LEAST(COALESCE(engagement_score, 0) + v_score_delta, 100),
    last_engaged_at = now()
  WHERE id = v_lead_id;

  RETURN NEW;
END;
$$;

-- 4. Attach trigger
CREATE TRIGGER trg_update_lead_engagement
  AFTER INSERT ON public.lead_engagement_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lead_engagement_on_event();

-- 5. Create hot_engaged_leads view
CREATE OR REPLACE VIEW public.hot_engaged_leads AS
SELECT
  l.id,
  l.name,
  l.phone,
  l.stage::text,
  l.source::text,
  l.engagement_score,
  l.lead_score,
  l.last_engaged_at,
  l.counsellor_id,
  c.name AS course_name,
  p.display_name AS counsellor_name,
  cam.name AS campus_name,
  (SELECT ee.event_type FROM public.lead_engagement_events ee
   WHERE ee.lead_id = l.id ORDER BY ee.created_at DESC LIMIT 1) AS last_event_type
FROM public.leads l
LEFT JOIN public.courses c ON c.id = l.course_id
LEFT JOIN public.profiles p ON p.id = l.counsellor_id
LEFT JOIN public.campuses cam ON cam.id = l.campus_id
WHERE l.engagement_score > 0
  AND l.stage NOT IN ('not_interested', 'ineligible', 'dnc', 'rejected')
ORDER BY l.last_engaged_at DESC;

-- 6. Grant SELECT on the view to authenticated role
GRANT SELECT ON public.hot_engaged_leads TO authenticated;

-- 7. Allow authenticated users to read engagement events (for lead detail page)
CREATE POLICY "authenticated_read_engagement_events"
  ON public.lead_engagement_events
  FOR SELECT
  TO authenticated
  USING (true);
