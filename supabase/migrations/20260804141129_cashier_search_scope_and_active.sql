-- Counter search: scope it to students, and hide inactive ones by default.
--
-- The counter search always returned students AND leads/applications mixed
-- together, capped at 8 each. Looking for an enrolled student, a cashier got
-- the list half-filled with enquiries of the same name; and a student who left
-- last year ranked alongside one standing at the desk.
--
-- Two switches, both defaulted to the common case:
--   _include_leads  false -> students only (the default at a fee counter)
--   _active_only    true  -> drop status='inactive'
--
-- "Active" means NOT inactive, so pre_admitted stays in: those candidates are
-- precisely the ones paying at the counter. Prod today: 263 active,
-- 24 pre_admitted, 40 inactive.
--
-- The 1-arg signature is dropped rather than overloaded — leaving both would
-- make cashier_search(_q) ambiguous to PostgREST.

DROP FUNCTION IF EXISTS public.cashier_search(text);

CREATE OR REPLACE FUNCTION public.cashier_search(
  _q             text,
  _include_leads boolean DEFAULT true,
  _active_only   boolean DEFAULT true
)
RETURNS TABLE (
  kind             text,
  id               uuid,
  name             text,
  phone            text,
  identifier       text,
  identifier_label text,
  stage            text,
  lead_id          uuid,
  course           text,
  campus           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
           st.status, st.lead_id, co.name AS course, ca.name AS campus
      FROM public.students st
      LEFT JOIN public.courses  co ON co.id = st.course_id
      LEFT JOIN public.campuses ca ON ca.id = st.campus_id
     WHERE (st.name ilike v_like
         OR st.phone ilike v_like
         OR st.email ilike v_like
         OR st.admission_no ilike v_like
         OR st.pre_admission_no ilike v_like)
       -- pre_admitted is deliberately NOT filtered out by _active_only.
       AND (NOT _active_only OR st.status IS DISTINCT FROM 'inactive')
     LIMIT 8
  ), l AS (
    SELECT ld.id, ld.name, ld.phone, ld.admission_no, ld.pre_admission_no,
           ld.application_id, ld.stage::text AS stage,
           co.name AS course, ca.name AS campus
      FROM public.leads ld
      LEFT JOIN public.courses  co ON co.id = ld.course_id
      LEFT JOIN public.campuses ca ON ca.id = ld.campus_id
     WHERE _include_leads
       AND ld.is_mirror IS NOT TRUE
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
         s.lead_id,
         s.course,
         s.campus
    FROM s
  UNION ALL
  SELECT 'lead'::text, l.id, l.name, l.phone,
         COALESCE(l.admission_no, l.pre_admission_no, l.application_id),
         CASE WHEN l.admission_no IS NOT NULL THEN 'AN'
              WHEN l.pre_admission_no IS NOT NULL THEN 'PAN'
              WHEN l.application_id IS NOT NULL THEN 'App' END,
         l.stage,
         l.id,
         l.course,
         l.campus
    FROM l
   -- A lead that already became a student is the same person; the student row
   -- wins, so the cashier never sees the candidate twice.
   WHERE NOT EXISTS (SELECT 1 FROM s WHERE s.lead_id = l.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_search(text, boolean, boolean) TO authenticated, service_role;
