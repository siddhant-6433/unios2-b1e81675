-- Backfill: elevate existing leads that already have a completed AI call >= 60% conversion.
-- Must be a separate migration because ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as the new enum value (PostgreSQL restriction).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (a.lead_id)
      a.lead_id
    FROM public.ai_call_records a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE a.status = 'completed'
      AND a.conversion_probability >= 60
      AND l.stage::text IN ('new_lead', 'counsellor_call')
    ORDER BY a.lead_id, a.conversion_probability DESC
  LOOP
    UPDATE public.leads SET stage = 'priority_interested' WHERE id = r.lead_id;
  END LOOP;
END;
$$;
