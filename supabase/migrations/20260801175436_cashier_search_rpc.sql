-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260801175436 name=cashier_search_rpc applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

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

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm    ON public.leads    USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm   ON public.leads    USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_name_trgm ON public.students USING gin (name gin_trgm_ops);

NOTIFY pgrst, 'reload schema';
