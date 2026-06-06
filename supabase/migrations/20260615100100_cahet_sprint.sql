-- CAHET Sprint: registrations table, storage bucket, queue/stats/leaderboard RPCs.
-- Deadline: 2026-06-10 23:59 IST. Pool: BPT + BMRIT leads (by course interest OR application course).

-- ========== STORAGE ==========

INSERT INTO storage.buckets (id, name, public)
VALUES ('cahet-registrations', 'cahet-registrations', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff can upload cahet docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cahet-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

CREATE POLICY "Staff can view cahet docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cahet-registrations' AND (
      public.has_role(auth.uid(), 'super_admin') OR
      public.has_role(auth.uid(), 'campus_admin') OR
      public.has_role(auth.uid(), 'admission_head') OR
      public.has_role(auth.uid(), 'counsellor')
    )
  );

-- ========== TABLE ==========

CREATE TABLE public.cahet_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  registration_no text NOT NULL,
  document_url text,
  notes text,
  registered_by uuid REFERENCES public.profiles(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cahet_registrations_registered_by_at
  ON public.cahet_registrations(registered_by, registered_at DESC);
CREATE INDEX idx_cahet_registrations_registered_at
  ON public.cahet_registrations(registered_at DESC);

ALTER TABLE public.cahet_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view cahet registrations"
  ON public.cahet_registrations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE POLICY "Staff can insert cahet registrations"
  ON public.cahet_registrations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  );

CREATE POLICY "Staff can update cahet registrations"
  ON public.cahet_registrations FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admission_head')
  );

-- ========== HELPER: identify BPT / BMRIT courses ==========

CREATE OR REPLACE FUNCTION public.is_bpt_or_bmrit_course(p_course_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = p_course_id
      AND (
        c.code IN ('BPT-GN', 'BMRIT-GN')
        OR c.name ILIKE '%BPT%'
        OR c.name ILIKE '%Bachelor%Physiotherapy%'
        OR c.name ILIKE '%BMRIT%'
        OR (c.name ILIKE '%Radiology%' AND c.name ILIKE '%B.Sc%')
      )
  );
$$;

-- Set of BPT/BMRIT lead_ids: either lead.course_id matches, OR any application
-- attached to that lead has a course_selections[].course_id that matches.
CREATE OR REPLACE VIEW public.cahet_bpt_bmrit_leads AS
SELECT DISTINCT l.id AS lead_id
FROM public.leads l
WHERE public.is_bpt_or_bmrit_course(l.course_id)
UNION
SELECT DISTINCT a.lead_id
FROM public.applications a
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.course_selections, '[]'::jsonb)) sel
WHERE a.lead_id IS NOT NULL
  AND public.is_bpt_or_bmrit_course(NULLIF(sel->>'course_id', '')::uuid);

GRANT SELECT ON public.cahet_bpt_bmrit_leads TO authenticated;

-- ========== RANKED QUEUE RPC ==========
-- Returns one row per BPT/BMRIT lead not yet registered, with a bucket label
-- and numeric score (higher = call first). Counsellor filter optional.
-- Bucket scoring (matches CAHET-sprint UI ranking):
--   100 paid_application
--    90 partial_application
--    80 unreplied_whatsapp     (student → us, no outbound after)
--    70 priority_interested    (Gemini-flagged stage)
--    60 engaged_whatsapp       (active 2-way + course match)
--    50 past_visit
--    40 in_followup            (followup scheduled in future)
--    30 overdue_followup       (followup overdue)
--    15 fresh_cold             (in pool but no activity matches above — still
--                                reachable so the full BPT/BMRIT pool is one click away)

CREATE OR REPLACE FUNCTION public.cahet_sprint_queue(
  p_counsellor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  lead_id uuid,
  lead_name text,
  phone text,
  course_name text,
  counsellor_id uuid,
  counsellor_name text,
  stage text,
  bucket text,
  score int,
  last_touch_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  next_followup_at timestamptz,
  visit_date timestamptz,
  application_status text,
  application_id text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pool AS (
    SELECT bb.lead_id FROM public.cahet_bpt_bmrit_leads bb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cahet_registrations cr WHERE cr.lead_id = bb.lead_id
    )
  ),
  app AS (
    SELECT DISTINCT ON (a.lead_id)
      a.lead_id, a.payment_status, a.application_id, a.updated_at
    FROM public.applications a
    WHERE a.lead_id IN (SELECT lead_id FROM pool)
    ORDER BY a.lead_id,
      CASE a.payment_status WHEN 'paid' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END,
      a.updated_at DESC
  ),
  wa_in AS (
    SELECT lead_id, MAX(created_at) AS last_inbound_at
    FROM public.whatsapp_messages
    WHERE direction = 'inbound' AND lead_id IN (SELECT lead_id FROM pool)
    GROUP BY lead_id
  ),
  wa_out AS (
    SELECT lead_id, MAX(created_at) AS last_outbound_at
    FROM public.whatsapp_messages
    WHERE direction = 'outbound' AND lead_id IN (SELECT lead_id FROM pool)
    GROUP BY lead_id
  ),
  visit AS (
    SELECT lead_id, MAX(visit_date) AS visit_date
    FROM public.campus_visits
    WHERE lead_id IN (SELECT lead_id FROM pool)
    GROUP BY lead_id
  ),
  fu_next AS (
    SELECT DISTINCT ON (lead_id) lead_id, scheduled_at AS next_followup_at, status
    FROM public.lead_followups
    WHERE status = 'pending' AND lead_id IN (SELECT lead_id FROM pool)
    ORDER BY lead_id, scheduled_at ASC
  ),
  enriched AS (
    SELECT
      l.id AS lead_id,
      l.name AS lead_name,
      l.phone,
      c.name AS course_name,
      l.counsellor_id,
      p.display_name AS counsellor_name,
      l.stage::text AS stage,
      l.visit_date AS lead_visit_date,
      a.payment_status,
      a.application_id,
      wi.last_inbound_at,
      wo.last_outbound_at,
      v.visit_date AS visit_date,
      fn.next_followup_at,
      l.updated_at AS lead_updated_at
    FROM pool po
    JOIN public.leads l ON l.id = po.lead_id
    LEFT JOIN public.courses c ON c.id = l.course_id
    LEFT JOIN public.profiles p ON p.id = l.counsellor_id
    LEFT JOIN app a ON a.lead_id = l.id
    LEFT JOIN wa_in wi ON wi.lead_id = l.id
    LEFT JOIN wa_out wo ON wo.lead_id = l.id
    LEFT JOIN visit v ON v.lead_id = l.id
    LEFT JOIN fu_next fn ON fn.lead_id = l.id
    WHERE p_counsellor_id IS NULL OR l.counsellor_id = p_counsellor_id
  ),
  scored AS (
    SELECT
      e.*,
      CASE
        WHEN e.payment_status = 'paid' THEN 'paid_application'
        WHEN e.payment_status = 'partial' THEN 'partial_application'
        WHEN e.last_inbound_at IS NOT NULL
             AND (e.last_outbound_at IS NULL OR e.last_outbound_at < e.last_inbound_at)
             AND e.last_inbound_at > now() - interval '21 days'
          THEN 'unreplied_whatsapp'
        WHEN e.stage = 'priority_interested' THEN 'priority_interested'
        WHEN e.last_inbound_at IS NOT NULL
             AND e.last_inbound_at > now() - interval '14 days'
          THEN 'engaged_whatsapp'
        WHEN e.visit_date IS NOT NULL OR e.lead_visit_date IS NOT NULL THEN 'past_visit'
        WHEN e.next_followup_at IS NOT NULL AND e.next_followup_at < now() THEN 'overdue_followup'
        WHEN e.next_followup_at IS NOT NULL THEN 'in_followup'
        ELSE 'fresh_cold'
      END AS bucket
    FROM enriched e
  )
  SELECT
    s.lead_id,
    s.lead_name,
    s.phone,
    s.course_name,
    s.counsellor_id,
    s.counsellor_name,
    s.stage,
    s.bucket,
    CASE s.bucket
      WHEN 'paid_application' THEN 100
      WHEN 'partial_application' THEN 90
      WHEN 'unreplied_whatsapp' THEN 80
      WHEN 'priority_interested' THEN 70
      WHEN 'engaged_whatsapp' THEN 60
      WHEN 'past_visit' THEN 50
      WHEN 'in_followup' THEN 40
      WHEN 'overdue_followup' THEN 30
      WHEN 'fresh_cold' THEN 15
      ELSE 10
    END AS score,
    GREATEST(
      COALESCE(s.lead_updated_at, 'epoch'::timestamptz),
      COALESCE(s.last_inbound_at, 'epoch'::timestamptz),
      COALESCE(s.last_outbound_at, 'epoch'::timestamptz)
    ) AS last_touch_at,
    s.last_inbound_at,
    s.last_outbound_at,
    s.next_followup_at,
    COALESCE(s.visit_date, s.lead_visit_date) AS visit_date,
    s.payment_status AS application_status,
    s.application_id
  FROM scored s
  ORDER BY score DESC, last_touch_at DESC NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_queue(uuid, int) TO authenticated;

-- ========== STATS RPC (ticker + dashboard) ==========

CREATE OR REPLACE FUNCTION public.cahet_sprint_stats(
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  own_count int,
  own_today int,
  team_count int,
  team_today int,
  pool_total int,
  pool_remaining int,
  deadline_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pool AS (SELECT lead_id FROM public.cahet_bpt_bmrit_leads),
  regs AS (SELECT * FROM public.cahet_registrations)
  SELECT
    COALESCE((SELECT COUNT(*)::int FROM regs WHERE registered_by = p_counsellor_id), 0) AS own_count,
    COALESCE((SELECT COUNT(*)::int FROM regs
              WHERE registered_by = p_counsellor_id
                AND registered_at >= date_trunc('day', now())), 0) AS own_today,
    (SELECT COUNT(*)::int FROM regs) AS team_count,
    (SELECT COUNT(*)::int FROM regs WHERE registered_at >= date_trunc('day', now())) AS team_today,
    (SELECT COUNT(*)::int FROM pool) AS pool_total,
    (SELECT COUNT(*)::int FROM pool po
       WHERE NOT EXISTS (SELECT 1 FROM regs r WHERE r.lead_id = po.lead_id)) AS pool_remaining,
    '2026-06-10 23:59:59+05:30'::timestamptz AS deadline_at;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_stats(uuid) TO authenticated;

-- ========== LEADERBOARD RPC ==========

CREATE OR REPLACE FUNCTION public.cahet_sprint_leaderboard(p_limit int DEFAULT 10)
RETURNS TABLE (
  counsellor_id uuid,
  counsellor_name text,
  total_count int,
  today_count int,
  last_registered_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.registered_by AS counsellor_id,
    COALESCE(p.display_name, 'Unknown') AS counsellor_name,
    COUNT(*)::int AS total_count,
    COUNT(*) FILTER (WHERE r.registered_at >= date_trunc('day', now()))::int AS today_count,
    MAX(r.registered_at) AS last_registered_at
  FROM public.cahet_registrations r
  LEFT JOIN public.profiles p ON p.id = r.registered_by
  WHERE r.registered_by IS NOT NULL
  GROUP BY r.registered_by, p.display_name
  ORDER BY total_count DESC, last_registered_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_leaderboard(int) TO authenticated;

-- ========== MARK-REGISTERED RPC ==========
-- Idempotent-ish: a lead can only be registered once (UNIQUE on lead_id).
-- registered_by is set to the caller's profile (matches auth.uid()).

CREATE OR REPLACE FUNCTION public.cahet_mark_registered(
  p_lead_id uuid,
  p_registration_no text,
  p_document_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.cahet_registrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.cahet_registrations;
  v_profile_id uuid;
BEGIN
  IF p_lead_id IS NULL OR p_registration_no IS NULL OR length(trim(p_registration_no)) = 0 THEN
    RAISE EXCEPTION 'lead_id and registration_no are required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'admission_head') OR
    public.has_role(auth.uid(), 'counsellor')
  ) THEN
    RAISE EXCEPTION 'not authorized to mark cahet registrations';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();

  INSERT INTO public.cahet_registrations (lead_id, registration_no, document_url, notes, registered_by)
  VALUES (p_lead_id, trim(p_registration_no), p_document_url, p_notes, v_profile_id)
  RETURNING * INTO v_row;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (p_lead_id, v_profile_id, 'system',
          'CAHET registration recorded (no: ' || trim(p_registration_no) || ')');

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_mark_registered(uuid, text, text, text) TO authenticated;

-- ========== SEARCH RPC (picker on /cahet-sprint) ==========
-- Backs the "Add from bucket" search dialog: lets counsellors jump to any
-- BPT/BMRIT lead by name or phone, even one that's hidden by the current
-- bucket/counsellor filter. Returns registered leads last so unregistered
-- (actionable) ones float to the top.

CREATE OR REPLACE FUNCTION public.cahet_search_pool(p_query text DEFAULT NULL, p_limit int DEFAULT 25)
RETURNS TABLE (
  lead_id uuid,
  lead_name text,
  phone text,
  course_name text,
  registered boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    l.id AS lead_id,
    l.name AS lead_name,
    l.phone,
    c.name AS course_name,
    EXISTS(SELECT 1 FROM public.cahet_registrations cr WHERE cr.lead_id = l.id) AS registered
  FROM public.cahet_bpt_bmrit_leads bb
  JOIN public.leads l ON l.id = bb.lead_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  WHERE p_query IS NULL OR p_query = ''
     OR l.name ILIKE '%' || p_query || '%'
     OR l.phone ILIKE '%' || p_query || '%'
  ORDER BY
    EXISTS(SELECT 1 FROM public.cahet_registrations cr WHERE cr.lead_id = l.id),
    l.name ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.cahet_search_pool(text, int) TO authenticated;
