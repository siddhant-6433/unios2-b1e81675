-- cashier search phone normalize
--
-- The counter search matched phones with a raw ILIKE '%q%', so it only found a
-- number typed exactly as stored. A cashier reading a number off a receipt
-- ("+91 98717 63193") or a parent quoting theirs with the country code got
-- "no such student" — the worst failure mode at a cash counter.
--
-- Two changes, both additive; every existing ILIKE branch is untouched so
-- name / email / AN / PAN / application-id search behaves exactly as before:
--   1. When the query has >= 4 digits, compare digits-to-digits with the
--      non-digits stripped from BOTH sides, and both reduced to their last 10
--      (an Indian mobile without its country code). Trimming both sides is what
--      makes it symmetric: the query can carry a +91 the stored value lacks, or
--      the reverse.
--   2. Search the parent numbers on a student (father/mother/guardian) and the
--      guardian number on a lead — for a school admission the number on file is
--      usually the father's, not the child's.
--
-- Deliberately no index on the normalized expression: both branches already
-- LIMIT 8 over a few hundred students, so the seq scan is cheaper than the
-- write cost of maintaining one. Revisit if the student count reaches five
-- figures.

CREATE OR REPLACE FUNCTION public.cashier_search(_q text, _include_leads boolean DEFAULT true, _active_only boolean DEFAULT true)
 RETURNS TABLE(kind text, id uuid, name text, phone text, identifier text, identifier_label text, stage text, lead_id uuid, course text, campus text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q      text := btrim(COALESCE(_q, ''));
  v_like   text;
  v_digits text;
  v_dlike  text;
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

  -- NULL when the query isn't phone-shaped, which makes every digit branch
  -- below NULL (i.e. not matched) without needing a second code path.
  v_digits := right(regexp_replace(v_q, '\D', '', 'g'), 10);
  v_dlike  := CASE WHEN length(v_digits) >= 4 THEN '%' || v_digits || '%' END;

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
         OR st.pre_admission_no ilike v_like
         OR right(regexp_replace(COALESCE(st.phone, ''), '\D', '', 'g'), 10) like v_dlike
         OR right(regexp_replace(COALESCE(st.father_phone, ''), '\D', '', 'g'), 10) like v_dlike
         OR right(regexp_replace(COALESCE(st.mother_phone, ''), '\D', '', 'g'), 10) like v_dlike
         OR right(regexp_replace(COALESCE(st.guardian_phone, ''), '\D', '', 'g'), 10) like v_dlike)
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
         OR ld.application_id ilike v_like
         OR right(regexp_replace(COALESCE(ld.phone, ''), '\D', '', 'g'), 10) like v_dlike
         OR right(regexp_replace(COALESCE(ld.guardian_phone, ''), '\D', '', 'g'), 10) like v_dlike)
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
$function$;
