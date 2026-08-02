-- ====================================================================
-- cashier_search — one indexed scan instead of a per-row RLS walk.
--
-- Measured on production before this: the cashier console's two client
-- queries took ~12s for an accountant. EXPLAIN showed why — the leads
-- RLS policy short-circuits cheaply for super_admin, but an accountant
-- only matches through the LAST term, `can_view_lead(auth.uid(), id)`,
-- which is a SECURITY DEFINER call evaluated PER ROW across ~7,800
-- candidate rows (378k shared buffer hits, 6,590 ms for just three
-- ilike columns). The same scan with RLS off is 31 ms.
--
-- Rather than rewrite the shared leads policy — a much bigger blast
-- radius — the counter search goes through a definer function with an
-- explicit role gate, the pattern already used elsewhere in this schema
-- for exactly this problem. The gate is deliberately narrow: this
-- returns names and phone numbers, so only finance roles may call it.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.cashier_search(_q text)
RETURNS TABLE (
  kind             text,
  id               uuid,
  name             text,
  phone            text,
  identifier       text,
  identifier_label text,
  stage            text,
  lead_id          uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_q    text := btrim(COALESCE(_q, ''));
  v_like text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'principal')
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF length(v_q) < 2 THEN
    RETURN;
  END IF;
  v_like := '%' || v_q || '%';

  RETURN QUERY
  WITH s AS (
    SELECT st.id, st.name, st.phone, st.admission_no, st.pre_admission_no,
           st.status, st.lead_id
      FROM public.students st
     WHERE st.name ilike v_like
        OR st.phone ilike v_like
        OR st.email ilike v_like
        OR st.admission_no ilike v_like
        OR st.pre_admission_no ilike v_like
     LIMIT 8
  ), l AS (
    SELECT ld.id, ld.name, ld.phone, ld.admission_no, ld.pre_admission_no,
           ld.application_id, ld.stage::text AS stage
      FROM public.leads ld
     WHERE ld.is_mirror IS NOT TRUE
       AND (ld.name ilike v_like
         OR ld.phone ilike v_like
         OR ld.email ilike v_like
         OR ld.admission_no ilike v_like
         OR ld.pre_admission_no ilike v_like
         OR ld.application_id ilike v_like)
     LIMIT 8
  )
  SELECT 'student'::text, s.id, s.name, s.phone,
         COALESCE(s.admission_no, s.pre_admission_no),
         CASE WHEN s.admission_no IS NOT NULL THEN 'AN'
              WHEN s.pre_admission_no IS NOT NULL THEN 'PAN' END,
         s.status::text,
         s.lead_id
    FROM s
  UNION ALL
  -- A lead whose student row already surfaced is the same person; prefer the
  -- student, which is the side that actually carries the fee ledger.
  SELECT 'lead'::text, l.id, l.name, l.phone,
         COALESCE(l.admission_no, l.pre_admission_no, l.application_id),
         CASE WHEN l.admission_no IS NOT NULL THEN 'AN'
              WHEN l.pre_admission_no IS NOT NULL THEN 'PAN'
              WHEN l.application_id IS NOT NULL THEN 'App' END,
         l.stage,
         l.id
    FROM l
   WHERE NOT EXISTS (SELECT 1 FROM s WHERE s.lead_id = l.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_search(text) TO authenticated, service_role;

-- Trigram indexes so the scan stays fast as the tables grow. pg_trgm is
-- already installed (similarity() search uses it elsewhere).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm    ON public.leads    USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm   ON public.leads    USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_name_trgm ON public.students USING gin (name gin_trgm_ops);

NOTIFY pgrst, 'reload schema';
