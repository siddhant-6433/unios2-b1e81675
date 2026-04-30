-- Per-year fee map for the locked structure: { year_1: 100000, year_2: 100000, ... }
-- Used by TokenFeePanel to build precise concession_breakdown for the
-- "Pay full course" CTA so the per-year audit lines up.
CREATE OR REPLACE FUNCTION public.lead_year_fees(_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(term, total), '{}'::jsonb)
  FROM (
    SELECT fsi.term, SUM(fsi.amount)::numeric AS total
      FROM public.fee_structure_items fsi
     WHERE fsi.fee_structure_id = public.lead_fee_structure_id(_lead_id)
       AND fsi.term LIKE 'year\_%' ESCAPE '\'
     GROUP BY fsi.term
  ) y;
$$;

GRANT EXECUTE ON FUNCTION public.lead_year_fees TO authenticated, service_role;
