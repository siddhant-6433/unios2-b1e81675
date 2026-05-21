-- Single RPC that returns everything LeadDetail needs for first paint:
--   - the lead row (with joined course, campus, counsellor names)
--   - up to 50 recent notes
--   - up to 30 followups
--   - up to 20 visits
--   - up to 50 activities
--   - up to 20 call logs
--
-- Replaces 6 separate per-lead client queries (plus the auth/RLS overhead of
-- each) with one round trip. Reference data (campuses + courses full lists)
-- moves to cached client hooks since they're nearly static.
--
-- SECURITY INVOKER → RLS still applies. The caller sees only the lead and
-- child rows they're allowed to see; if RLS blocks the lead, every nested
-- collection comes back empty.

CREATE OR REPLACE FUNCTION public.lead_detail(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  lead_row AS (
    SELECT
      to_jsonb(l) || jsonb_build_object(
        'lead_course',     CASE WHEN c.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', c.name, 'duration_years', c.duration_years, 'type', c.type) END,
        'lead_campus',     CASE WHEN cmp.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', cmp.name, 'city', cmp.city, 'state', cmp.state) END,
        'lead_counsellor', CASE WHEN p.id IS NULL THEN NULL
                                ELSE jsonb_build_object('display_name', p.display_name) END
      ) AS row
    FROM public.leads l
    LEFT JOIN public.courses   c   ON c.id   = l.course_id
    LEFT JOIN public.campuses  cmp ON cmp.id = l.campus_id
    LEFT JOIN public.profiles  p   ON p.id   = l.counsellor_id
    WHERE l.id = p_lead_id
  ),
  notes_arr AS (
    SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) AS rows
    FROM (
      SELECT * FROM public.lead_notes WHERE lead_id = p_lead_id
      ORDER BY created_at DESC LIMIT 50
    ) n
  ),
  followups_arr AS (
    SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_at ASC) AS rows
    FROM (
      SELECT * FROM public.lead_followups WHERE lead_id = p_lead_id
      ORDER BY scheduled_at ASC LIMIT 30
    ) f
  ),
  visits_arr AS (
    SELECT jsonb_agg(to_jsonb(v) ORDER BY v.visit_date DESC) AS rows
    FROM (
      SELECT * FROM public.campus_visits WHERE lead_id = p_lead_id
      ORDER BY visit_date DESC LIMIT 20
    ) v
  ),
  activities_arr AS (
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) AS rows
    FROM (
      SELECT * FROM public.lead_activities WHERE lead_id = p_lead_id
      ORDER BY created_at DESC LIMIT 50
    ) a
  ),
  call_logs_arr AS (
    SELECT jsonb_agg(to_jsonb(cl) ORDER BY cl.called_at DESC) AS rows
    FROM (
      SELECT * FROM public.call_logs WHERE lead_id = p_lead_id
      ORDER BY called_at DESC LIMIT 20
    ) cl
  )
SELECT jsonb_build_object(
  'lead',       (SELECT row  FROM lead_row),
  'notes',      COALESCE((SELECT rows FROM notes_arr),      '[]'::jsonb),
  'followups',  COALESCE((SELECT rows FROM followups_arr),  '[]'::jsonb),
  'visits',     COALESCE((SELECT rows FROM visits_arr),     '[]'::jsonb),
  'activities', COALESCE((SELECT rows FROM activities_arr), '[]'::jsonb),
  'call_logs',  COALESCE((SELECT rows FROM call_logs_arr),  '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.lead_detail(uuid) TO authenticated;

-- Supporting indexes for fast per-lead descending-order reads
CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_created
  ON public.lead_notes (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_created
  ON public.lead_activities (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_logs_lead_called
  ON public.call_logs (lead_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_campus_visits_lead_date
  ON public.campus_visits (lead_id, visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_lead_followups_lead_scheduled
  ON public.lead_followups (lead_id, scheduled_at ASC);
