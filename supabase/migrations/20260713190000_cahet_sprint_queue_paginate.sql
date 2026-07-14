-- CAHET sprint queue: paginate past Supabase/PostgREST ~1000-row RPC cap
-- so "Save as list" can include the full BPT/BMRIT pool (~1.4k+ leads).

DROP FUNCTION IF EXISTS public.cahet_sprint_queue(uuid, int);

CREATE OR REPLACE FUNCTION public.cahet_sprint_queue(
  p_counsellor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
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
  LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.cahet_sprint_queue(uuid, int, int) TO authenticated;

COMMENT ON FUNCTION public.cahet_sprint_queue(uuid, int, int) IS
  'CAHET BPT/BMRIT sprint work queue. Paginate with p_limit/p_offset to load the full pool past API row caps.';
