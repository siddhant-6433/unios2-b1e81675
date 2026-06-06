-- Extend the BPT/BMRIT CAHET sprint deadline to 10 June 2026 11:59 PM IST.

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

UPDATE public.whatsapp_template_settings
SET description = '10 June 2026 application + CAHET registration deadline'
WHERE template_key = 'bpt_bmrit_cahet_deadline';
